import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, doc, updateDoc, increment, query, where, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Collection Names
const QUESTIONS_COL = "questions";
const STATS_COL = "stats"; 
const HISTORY_COL = "history";


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
}


export async function getDashboardStats(category = 'all') {
    const colRef = collection(db, QUESTIONS_COL);
    const querySnapshot = await getDocs(colRef);
    let total = 0;
    let mastered = 0;
    const batchSet = new Set();

    querySnapshot.forEach(doc => {
        const data = doc.data();
        const id = doc.id;

        // Extract batch from ID (e.g., sf_adm_batch008_q15 or sf_admin_001_v1)
        const match = id.match(/batch(\d+)/) || id.match(/_v(\d+)$/);
        if (match) {
            batchSet.add(match[1]);
        }

        if (category === 'all' || data.category === category) {
            total++;
            if (data.masteryCount >= 5) mastered++;
        }
    });

    return { 
        total, 
        mastered, 
        batches: batchSet.size || 0 
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



