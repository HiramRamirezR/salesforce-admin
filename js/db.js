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
        // We use a specific ID if provided, otherwise firebase generates one
        const qId = q.id || `q_${Date.now()}_${count}`;
        await setDoc(doc(db, QUESTIONS_COL, qId), {
            ...q,
            masteryCount: 0,
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
    if (isCorrect) {
        await updateDoc(qRef, {
            masteryCount: increment(1)
        });
    } else {
        // If wrong, reset or decrease? User said "acertarla 5 veces". 
        // Let's just not increment if wrong. Or we could reset to 0 to be stricter?
        // Let's just keep it as "correct count" for now.
    }
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


