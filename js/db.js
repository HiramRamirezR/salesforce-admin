import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, doc, updateDoc, increment, query, where, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Collection Names
const QUESTIONS_COL = "questions";
const MASTERY_COL = "mastery_units"; 
const STATS_COL = "stats"; 
const HISTORY_COL = "history";
const CAT_SCORES_COL = "category_scores";

// Local Cache system to stay within Spark Plan (Free)
let cachedUnits = null;

async function getCachedUnits() {
    if (cachedUnits) return cachedUnits;
    const colRef = collection(db, MASTERY_COL);
    const snapshot = await getDocs(colRef);
    cachedUnits = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return cachedUnits;
}

export function clearCache() {
    cachedUnits = null;
}


export async function saveQuestions(questionsArray) {
    const colRef = collection(db, QUESTIONS_COL);
    let count = 0;
    
    // Get current batch count to increment it
    const statsRef = doc(db, STATS_COL, "global");
    const statsDoc = await getDoc(statsRef);
    let nextBatch = 1;
    if (statsDoc.exists()) {
        nextBatch = (statsDoc.data().batchCount || 0) + 1;
    }

    for (const q of questionsArray) {
        const qId = q.id || `q_${Date.now()}_${count}`;
        await setDoc(doc(db, QUESTIONS_COL, qId), {
            ...q,
            batchId: q.batchId || nextBatch,
            masteryCount: q.masteryCount || 0,
            attempts: q.attempts || 0,
            correctCount: q.correctCount || 0,
            lastUpdated: new Date()
        }, { merge: true });
        count++;
    }

    // Update global batch count
    await setDoc(statsRef, { batchCount: nextBatch }, { merge: true });
    
    return count;
}


export async function getExamQuestions(limit = 30, category = 'all') {
    const colRef = collection(db, QUESTIONS_COL);
    const querySnapshot = await getDocs(colRef);
    let allQuestions = [];
    querySnapshot.forEach(doc => {
        allQuestions.push({ id: doc.id, ...doc.data() });
    });

    if (category !== 'all') {
        allQuestions = allQuestions.filter(q => q.category === category);
    }


    // Strategy: 5% Mastered (Count >= 5) to minimize easy questions, 95% Others
    const mastered = allQuestions.filter(q => q.masteryCount >= 5);
    const practice = allQuestions.filter(q => q.masteryCount < 5);

    // Shuffle both
    const shuffledMastered = mastered.sort(() => 0.5 - Math.random());
    const shuffledPractice = practice.sort(() => 0.5 - Math.random());

    // Select proportionally (max 5% mastered to focus on new/weak areas)
    const masteredTarget = Math.floor(limit * 0.05);
    const selectedMastered = shuffledMastered.slice(0, masteredTarget);
    const selectedPractice = shuffledPractice.slice(0, limit - selectedMastered.length);

    // Combine and shuffle final set
    return [...selectedMastered, ...selectedPractice].sort(() => 0.5 - Math.random());
}


export async function updateMastery(questionId, isCorrect) {
    const qRef = doc(db, QUESTIONS_COL, questionId);
    const updates = {
        attempts: increment(1)
    };
    if (isCorrect) {
        updates.masteryCount = increment(1);
        updates.correctCount = increment(1);
    }
    await updateDoc(qRef, updates);
    clearCache();
}


export async function getDashboardStats(category = 'all') {
    const units = await getCachedUnits();
    let total = 0;
    let mastered = 0;

    units.forEach(data => {
        if (category === 'all' || data.category === category) {
            total++;
            if (data.status === 'mastered') mastered++;
        }
    });

    return { 
        total, 
        mastered, 
        batches: Math.ceil(total / 10) 
    };
}


export async function saveExamResult(result) {
    const colRef = collection(db, HISTORY_COL);
    await addDoc(colRef, {
        ...result,
        timestamp: new Date()
    });
}

export async function getExamHistory() {
    const colRef = collection(db, HISTORY_COL);
    const q = query(colRef, where("timestamp", ">", new Date(0))); // dummy where to allow ordering if needed or just get all
    const querySnapshot = await getDocs(colRef);
    const history = [];
    querySnapshot.forEach(doc => {
        history.push({ id: doc.id, ...doc.data() });
    });
    // Sort by timestamp descending
    return history.sort((a, b) => b.timestamp - a.timestamp);
}

export async function getUniqueCategories() {
    const colRef = collection(db, QUESTIONS_COL);
    const querySnapshot = await getDocs(colRef);
    const categories = new Set();
    querySnapshot.forEach(doc => {
        if (doc.data().category) categories.add(doc.data().category);
    });
    return Array.from(categories).sort();
}

export async function getCategoryPerformance() {
    const colRef = collection(db, QUESTIONS_COL);
    const querySnapshot = await getDocs(colRef);
    const performance = {};
    
    querySnapshot.forEach(doc => {
        const data = doc.data();
        const cat = data.category || "General";
        if (!performance[cat]) performance[cat] = { total: 0, correct: 0, attempts: 0 };
        performance[cat].total++;
        performance[cat].correct += (data.correctCount || 0);
        performance[cat].attempts += (data.attempts || 0);
    });
    
    return performance;
}

export async function getStrugglingQuestions() {
    const colRef = collection(db, QUESTIONS_COL);
    const querySnapshot = await getDocs(colRef);
    const struggling = [];
    
    querySnapshot.forEach(doc => {
        const data = doc.data();
        // A question is struggling if attempts > 0 and masteryCount < 5
        if ((data.attempts || 0) > 0 && (data.masteryCount || 0) < 5) {
            struggling.push({ id: doc.id, ...data });
        }
    });
    
    return struggling;
}

export async function updateStudyStats(secondsAdded) {
    const statsRef = doc(db, STATS_COL, "user_experience");
    const statsDoc = await getDoc(statsRef);
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    let data = statsDoc.exists() ? statsDoc.data() : {
        streak: 0,
        lastStudyDate: "",
        studyTimeByDate: {}
    };

    // Update Time Today
    const currentTimeToday = (data.studyTimeByDate && data.studyTimeByDate[today]) ? data.studyTimeByDate[today] : 0;
    const newTimeToday = currentTimeToday + secondsAdded;

    // Update Streak
    let newStreak = data.streak || 0;
    if (data.lastStudyDate === yesterday) {
        newStreak++;
    } else if (data.lastStudyDate !== today) {
        // If they missed a day, and it's not today, reset to 1
        newStreak = 1;
    }
    // If lastStudyDate === today, streak stays the same

    await setDoc(statsRef, {
        streak: newStreak,
        lastStudyDate: today,
        studyTimeByDate: {
            ...data.studyTimeByDate,
            [today]: newTimeToday
        }
    }, { merge: true });

    return { streak: newStreak, timeToday: newTimeToday };
}

export async function getExperienceStats() {
    const statsRef = doc(db, STATS_COL, "user_experience");
    const statsDoc = await getDoc(statsRef);
    const today = new Date().toISOString().split('T')[0];

    if (!statsDoc.exists()) return { streak: 0, timeToday: 0 };

    const data = statsDoc.data();
    const timeToday = (data.studyTimeByDate && data.studyTimeByDate[today]) ? data.studyTimeByDate[today] : 0;
    
    // Check if streak is still valid (if not today or yesterday, it's 0)
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    let streak = data.streak || 0;
    if (data.lastStudyDate !== today && data.lastStudyDate !== yesterday) {
        streak = 0;
    }

    return { streak, timeToday };
}



// MASTERY SYSTEM FUNCTIONS

export async function saveMasteryUnits(units) {
    let count = 0;
    for (const unit of units) {
        const docRef = doc(db, MASTERY_COL, unit.id);
        await setDoc(docRef, {
            ...unit,
            masteryProgress: 0, // 0 to 5
            attempts: 0,
            status: 'locked', // locked, learning, practicing, mastered
            lastAttempt: null
        }, { merge: true });
        count++;
    }
    return count;
}

export async function getUnitsByTopic(topic) {
    const colRef = collection(db, MASTERY_COL);
    const q = topic === 'all' 
        ? query(colRef)
        : query(colRef, where("category", "==", topic));
        
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function updateUnitMastery(unitId, isMasteryPoint) {
    const docRef = doc(db, MASTERY_COL, unitId);
    
    if (isMasteryPoint) {
        await updateDoc(docRef, {
            masteryProgress: 5,
            status: 'mastered',
            attempts: increment(1),
            lastAttempt: new Date()
        });
        clearCache();
        return { newProgress: 5, newStatus: 'mastered' };
    } else {
        // If they failed the first attempt, we could track it or just leave it
        await updateDoc(docRef, {
            attempts: increment(1),
            lastAttempt: new Date(),
            status: 'practicing'
        });
        clearCache();
        return { newStatus: 'practicing' };
    }
}

export async function updateUnitStatus(unitId, newStatus) {
    const docRef = doc(db, MASTERY_COL, unitId);
    await updateDoc(docRef, { status: newStatus });
}

export async function recordUnitExamFailure(conceptString, category) {
    const colRef = collection(db, MASTERY_COL);
    // Split by comma in case the AI combined multiple concepts
    const conceptNames = conceptString.split(',').map(c => c.trim());
    
    for (const conceptName of conceptNames) {
        // Try exact match first
        const q = query(colRef, where("concept", "==", conceptName), where("category", "==", category));
        let snapshot = await getDocs(q);
        
        // If not found, try a more flexible match
        if (snapshot.empty) {
            const q2 = query(colRef, where("concept", "==", conceptName));
            snapshot = await getDocs(q2);
        }

        if (!snapshot.empty) {
            const docRef = doc(db, MASTERY_COL, snapshot.docs[0].id);
            await updateDoc(docRef, {
                examFailures: increment(1)
            });
            clearCache();
        }
    }
}

export async function recordUnitExamSuccess(conceptString, category) {
    const colRef = collection(db, MASTERY_COL);
    const conceptNames = conceptString.split(',').map(c => c.trim());
    
    for (const conceptName of conceptNames) {
        const q = query(colRef, where("concept", "==", conceptName), where("category", "==", category));
        let snapshot = await getDocs(q);
        
        if (snapshot.empty) {
            const q2 = query(colRef, where("concept", "==", conceptName));
            snapshot = await getDocs(q2);
        }

        if (!snapshot.empty) {
            const docRef = doc(db, MASTERY_COL, snapshot.docs[0].id);
            await updateDoc(docRef, {
                examFailures: 0 // Success clears the counter
            });
            clearCache();
        }
    }
}

export async function updateCategoryHighScore(category, score, failedCount = 0) {
    const docRef = doc(db, CAT_SCORES_COL, category);
    const docSnap = await getDoc(docRef);
    
    const updates = { 
        failedCount: increment(failedCount)
    };
    
    if (typeof score === 'number') {
        updates.lastScore = score;
    }

    if (docSnap.exists()) {
        const currentHigh = docSnap.data().highScore || 0;
        if (typeof score === 'number' && score > currentHigh) {
            updates.highScore = score;
        }
        await updateDoc(docRef, updates);
    } else {
        await setDoc(docRef, { 
            highScore: typeof score === 'number' ? score : 0, 
            lastScore: typeof score === 'number' ? score : 0, 
            failedCount: failedCount 
        });
    }
}

async function getCategoryScores() {
    const colRef = collection(db, CAT_SCORES_COL);
    const snapshot = await getDocs(colRef);
    const data = {};
    snapshot.forEach(doc => {
        data[doc.id] = doc.data();
    });
    return data;
}

// Official weights definition
const OFFICIAL_WEIGHTS = {
    "Data & Analytics Management": 17,
    "Configuration & Setup": 15,
    "Object Manager & Lightning App Builder": 15,
    "Automation": 15,
    "Sales & Marketing": 10,
    "Service & Support": 10,
    "Productivity & Collaboration": 10,
    "Agentforce AI": 8
};

export async function getExamMasteryProgress() {
    const units = await getCachedUnits();
    const scoresData = await getCategoryScores();
    const progress = {
        _mixed_: scoresData["Mixed Mastery"] || { lastScore: null, failedCount: 0 }
    };
    
    Object.keys(OFFICIAL_WEIGHTS).forEach(cat => {
        const catData = scoresData[cat] || { highScore: 0, lastScore: null, failedCount: 0 };
        progress[cat] = { 
            total: 0, 
            mastered: 0, 
            weight: OFFICIAL_WEIGHTS[cat], 
            units: [], 
            highScore: catData.highScore, 
            lastScore: catData.lastScore,
            failedCount: catData.failedCount || 0 
        };
    });

    units.forEach(data => {
        const cat = data.category;
        if (progress[cat]) {
            progress[cat].total++;
            if (data.status === 'mastered') progress[cat].mastered++;
            progress[cat].units.push({
                id: data.id,
                concept: data.concept,
                status: data.status,
                category: data.category,
                examFailures: data.examFailures || 0
            });
        }
    });
    
    return progress;
}

