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
    for (const q of questionsArray) {
        const qId = q.id || `q_${Date.now()}_${count}`;
        await setDoc(doc(db, QUESTIONS_COL, qId), {
            ...q,
            masteryCount: q.masteryCount || 0,
            attempts: q.attempts || 0,
            correctCount: q.correctCount || 0,
            lastUpdated: new Date()
        }, { merge: true });
        count++;
    }
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


    // Strategy: 1/3 Mastered (Count >= 5), 2/3 Others
    const mastered = allQuestions.filter(q => q.masteryCount >= 5);
    const practice = allQuestions.filter(q => q.masteryCount < 5);

    // Shuffle both
    const shuffledMastered = mastered.sort(() => 0.5 - Math.random());
    const shuffledPractice = practice.sort(() => 0.5 - Math.random());

    // Select proportionally
    const masteredTarget = Math.floor(limit / 3);
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
    querySnapshot.forEach(doc => {
        const data = doc.data();
        if (category === 'all' || data.category === category) {
            total++;
            if (data.masteryCount >= 5) mastered++;
        }
    });
    return { total, mastered };
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



