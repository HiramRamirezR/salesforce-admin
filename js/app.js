import * as DB from './db.js';
import { evaluateMastery } from './ai-evaluator.js';

// --- State Management ---
let currentQuestions = [];
let currentIndex = 0;
let userAnswers = []; // { qIndex, selectedIndices, isCorrect }
let timerInterval = null;
let timeLeft = 52.5 * 60; // 52 minutes and 30 seconds
let sessionStartTime = null; 
let studyTicker = null;

// --- DOM Elements ---
const views = {
    home: document.getElementById('home-view'),
    import: document.getElementById('import-view'),
    exam: document.getElementById('exam-view'),
    history: document.getElementById('history-view'),
    mistakes: document.getElementById('mistakes-view'),
    study: document.getElementById('study-view'),
    results: document.getElementById('results-view'),
    review: document.getElementById('review-view'),
    masteryPractice: document.getElementById('mastery-practice-view')
};

const OFFICIAL_WEIGHTS = {
    "Data Modeling and Management": 17,
    "Configuration and Setup": 15,
    "Object Manager and Lightning App Builder": 15,
    "Automation": 15,
    "Sales and Marketing Applications": 10,
    "Service and Support Applications": 10,
    "Productivity and Collaboration": 10,
    "Agentforce AI": 8
};



const liveStats = {
    container: document.getElementById('exam-live-stats'),
    correct: document.getElementById('live-correct'),
    error: document.getElementById('live-error'),
    pending: document.getElementById('live-pending'),
    perc: document.getElementById('live-perc')
};


// --- View Navigation ---
function showView(viewName) {
    // Save session time if leaving active mode
    if (sessionStartTime) {
        stopSessionTimer();
    }

    Object.values(views).forEach(v => v.classList.add('hidden'));
    views[viewName].classList.remove('hidden');
    
    if (viewName === 'exam' || viewName === 'study') {
        startSessionTimer();
    }

    if (viewName === 'exam') {
        document.getElementById('timer').classList.remove('hidden');
        liveStats.container.classList.remove('hidden');
    } else {
        document.getElementById('timer').classList.add('hidden');
        liveStats.container.classList.add('hidden');
    }
}


function startSessionTimer() {
    sessionStartTime = Date.now();
    // Ticker to update UI every minute without DB calls, or just wait for save
    studyTicker = setInterval(() => {
        // UI only update could go here
    }, 10000);
}

async function stopSessionTimer() {
    if (!sessionStartTime) return;
    const seconds = Math.floor((Date.now() - sessionStartTime) / 1000);
    clearInterval(studyTicker);
    sessionStartTime = null;
    
    if (seconds > 0) {
        await DB.updateStudyStats(seconds);
        // Refresh display if we are on home
        if (!views.home.classList.contains('hidden')) loadDashboard();
    }
}


// --- Dashboard Logic ---
async function loadDashboard() {
    const stats = await DB.getDashboardStats();
    const exp = await DB.getExperienceStats();

    document.getElementById('total-questions').textContent = stats.total;
    document.getElementById('mastered-count').textContent = stats.mastered;
    
    document.getElementById('study-streak').textContent = exp.streak;
    const minsToday = Math.floor(exp.timeToday / 60);
    document.getElementById('study-time-today').textContent = `${minsToday}m`;

    // Populate Categories Dropdown with Official Topics
    const officialTopics = [
        "Data & Analytics Management",
        "Configuration & Setup",
        "Object Manager & Lightning App Builder",
        "Automation",
        "Sales & Marketing",
        "Service & Support",
        "Productivity & Collaboration",
        "Agentforce AI"
    ];
    
    const catSelect = document.getElementById('category-select');
    catSelect.innerHTML = '<option value="all">All Topics (Mixed)</option>';
    officialTopics.forEach(topic => {
        const opt = document.createElement('option');
        opt.value = topic;
        opt.textContent = topic;
        catSelect.appendChild(opt);
    });

    const pastScores = JSON.parse(localStorage.getItem('sf_scores') || '[]');
    if (pastScores.length > 0) {
        const avg = pastScores.reduce((a, b) => a + b, 0) / pastScores.length;
        document.getElementById('avg-score').textContent = `${Math.round(avg)}%`;
    }

    renderGlobalMastery();
}

async function renderGlobalMastery() {
    const masteryStats = await DB.getExamMasteryProgress();
    const container = document.getElementById('mastery-bars-container');
    container.innerHTML = '';

    // Official topics in order
    const topics = [
        "Data & Analytics Management",
        "Configuration & Setup",
        "Object Manager & Lightning App Builder",
        "Automation",
        "Sales & Marketing",
        "Service & Support",
        "Productivity & Collaboration",
        "Agentforce AI"
    ];

    topics.forEach(cat => {
        const stats = masteryStats[cat] || { total: 0, mastered: 0, weight: 0 };
        const masteryPerc = stats.total > 0 ? Math.round((stats.mastered / stats.total) * 100) : 0;
        const isLoaded = stats.total > 0;
        
        const div = document.createElement('div');
        div.style.marginBottom = '20px';
        div.style.opacity = isLoaded ? '1' : '0.4';
        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 6px;">
                <span>
                    <strong>${cat}</strong> 
                    <span style="color: var(--text-muted); font-size: 0.75rem;">(Weight: ${stats.weight || 0}%)</span>
                    ${isLoaded ? ' <span style="color: var(--success); font-size: 0.7rem;">[LOADED]</span>' : ' <span style="color: var(--error); font-size: 0.7rem;">[EMPTY]</span>'}
                </span>
                <span style="color: var(--warning); font-weight: 700;">${masteryPerc}% Mastered</span>
            </div>
            <div style="height: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; overflow: hidden; margin-bottom: 4px; border: 1px solid ${isLoaded ? 'var(--warning)' : 'var(--border)'};">
                <div style="height: 100%; width: ${masteryPerc}%; background: linear-gradient(90deg, var(--warning), #ffcc00); transition: width 1s ease;"></div>
            </div>
            <div style="font-size: 0.7rem; color: var(--text-muted);">
                ${isLoaded ? `${stats.mastered} of ${stats.total} scenarios conquered` : 'No scenarios imported yet'}
            </div>
        `;
        container.appendChild(div);
    });
}


async function updateCategoryPool() {
    const cat = document.getElementById('category-select').value;
    const stats = await DB.getDashboardStats(cat);
    const exp = await DB.getExperienceStats();

    document.getElementById('total-questions').textContent = stats.total;
    document.getElementById('mastered-count').textContent = stats.mastered;
    document.getElementById('batches-count').textContent = stats.batches;
    document.getElementById('study-streak').textContent = exp.streak;
    const minsToday = Math.floor(exp.timeToday / 60);
    document.getElementById('study-time-today').textContent = `${minsToday}m`;
}


// --- Exam Logic ---
async function startExam() {
    const lengthSelect = document.getElementById('exam-length-select');
    const mode = lengthSelect.value;
    let totalToFetch = 30;
    
    if (mode === 'survival' || mode === 'simulation') totalToFetch = 65;
    else totalToFetch = parseInt(mode) || 30;
    
    const catSelect = document.getElementById('category-select');
    const selectedCategory = catSelect.value;
    
    currentQuestions = await DB.getExamQuestions(totalToFetch, selectedCategory);
    
    if (currentQuestions.length === 0) {
        alert("No questions found for this category or the bank is empty.");
        return;
    }

    currentIndex = 0;
    userAnswers = [];
    
    if (mode === 'survival') {
        timeLeft = 0;
        document.getElementById('timer').classList.add('hidden');
    } else if (mode === 'simulation') {
        timeLeft = 105 * 60; // Official 105 mins
        document.getElementById('timer').classList.remove('hidden');
    } else {
        timeLeft = Math.floor(currentQuestions.length * 1.75 * 60);
        document.getElementById('timer').classList.remove('hidden');
    }

    
    updateLiveStats();
    if (mode !== 'survival') startTimer();


    showView('exam');
    renderQuestion();
}


function startTimer() {
    const timerEl = document.getElementById('timer');
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        timeLeft--;
        const mins = Math.floor(timeLeft / 60);
        const secs = timeLeft % 60;
        timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
        if (timeLeft <= 0) endExam();
    }, 1000);
}

function renderQuestion() {
    const q = currentQuestions[currentIndex];
    const isMultiple = q.options.filter(o => o.isCorrect).length > 1;
    
    document.getElementById('q-category').textContent = q.category || "General";
    document.getElementById('q-text').textContent = q.question;
    document.getElementById('q-counter').textContent = `Question ${currentIndex + 1} of ${currentQuestions.length}`;
    document.getElementById('progress-bar').style.width = `${((currentIndex) / currentQuestions.length) * 100}%`;

    const optionsContainer = document.getElementById('q-options');
    optionsContainer.innerHTML = '';

    // Shuffle options al vuelo as requested
    const shuffledOptions = [...q.options].map((o, idx) => ({ ...o, originalIdx: idx }))
                                            .sort(() => 0.5 - Math.random());

    shuffledOptions.forEach((opt, idx) => {
        const div = document.createElement('div');
        div.className = 'option-item';
        div.innerHTML = `
            <div class="checkbox-visual"></div>
            <span>${opt.text}</span>
        `;
        div.onclick = () => toggleOption(div, opt, isMultiple);
        optionsContainer.appendChild(div);
    });

    const nextBtn = document.getElementById('next-q-btn');
    nextBtn.textContent = "Check Answer";
    nextBtn.onclick = () => validateAnswer(isMultiple);
}

function toggleOption(ele, opt, isMultiple) {
    if (!isMultiple) {
        document.querySelectorAll('.option-item').forEach(i => i.classList.remove('selected'));
    }
    ele.classList.toggle('selected');
}

async function validateAnswer(isMultiple) {
    const selectedElements = document.querySelectorAll('.option-item.selected');
    if (selectedElements.length === 0) return;

    const q = currentQuestions[currentIndex];
    const mode = document.getElementById('exam-length-select').value;
    const correctAnswers = q.options.filter(o => o.isCorrect).map(o => o.text);
    const selectedAnswers = Array.from(selectedElements).map(el => el.querySelector('span').textContent);

    const isCorrect = correctAnswers.length === selectedAnswers.length && 
                      correctAnswers.every(val => selectedAnswers.includes(val));

    // UI Feedback (Hidden in simulation until the end)
    if (mode !== 'simulation') {
        document.querySelectorAll('.option-item').forEach(el => {
            const text = el.querySelector('span').textContent;
            if (correctAnswers.includes(text)) el.classList.add('correct');
            else if (selectedAnswers.includes(text)) el.classList.add('error');
        });
    }

    userAnswers.push({ qIndex: currentIndex, isCorrect, explanation: q.explanation });


    // Update Live Stats
    updateLiveStats();

    // Update Mastery in DB
    await DB.updateMastery(q.id, isCorrect);

    // Survival Check
    if (mode === 'survival' && !isCorrect) {

        setTimeout(() => {
            alert("☠️ SURVIVAL ENDED: One mistake and you're out!");
            endExam();
        }, 1000);
        return;
    }

    const nextBtn = document.getElementById('next-q-btn');

    nextBtn.textContent = currentIndex === currentQuestions.length - 1 ? "Finish Exam" : "Next Question";
    nextBtn.onclick = () => {
        if (currentIndex < currentQuestions.length - 1) {
            currentIndex++;
            renderQuestion();
        } else {
            endExam();
        }
    };
}

async function endExam() {
    clearInterval(timerInterval);
    const score = userAnswers.filter(a => a.isCorrect).length;
    const total = currentQuestions.length;
    const percentage = Math.round((score / total) * 100);
    const mode = document.getElementById('exam-length-select').value;
    
    // Save to Firestore History
    await DB.saveExamResult({
        score,
        total,
        percentage,
        mode,
        date: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString()
    });

    const badge = document.getElementById('simulation-badge');
    if (mode === 'simulation') {
        badge.classList.remove('hidden');
        const passed = percentage >= 65;
        badge.style.background = passed ? 'var(--success)' : 'var(--error)';
        badge.textContent = passed ? 'SIMULATION: PASS ✅' : 'SIMULATION: FAIL ❌';
        document.getElementById('result-message').textContent = passed ? "You're ready for the real deal!" : "Close! Review your weak areas.";
    } else {
        badge.classList.add('hidden');
        document.getElementById('result-message').textContent = percentage >= 80 ? "Certified Ready! 🚀" : "Keep practicing, Trailblazer!";
    }

    document.getElementById('final-percentage').textContent = `${percentage}%`;

    
    // Save to local for avg
    const pastScores = JSON.parse(localStorage.getItem('sf_scores') || '[]');
    pastScores.push(percentage);
    localStorage.setItem('sf_scores', JSON.stringify(pastScores));

    renderCategoryReport();
    showView('results');
}

function renderCategoryReport() {
    const report = {}; 
    currentQuestions.forEach((q, idx) => {
        const cat = q.category || "General";
        if (!report[cat]) report[cat] = { total: 0, correct: 0 };
        report[cat].total++;
        if (userAnswers[idx]?.isCorrect) report[cat].correct++;
    });

    const container = document.getElementById('category-report');
    container.innerHTML = '<h3 style="margin-bottom: 16px;">Breakdown by Category</h3>';
    
    for (const [cat, stats] of Object.entries(report)) {
        const perc = Math.round((stats.correct / stats.total) * 100);
        const color = perc < 60 ? 'var(--error)' : (perc < 85 ? 'var(--warning)' : 'var(--success)');
        container.innerHTML += `
            <div style="margin-bottom: 8px;">
                <div style="display: flex; justify-content: space-between; font-size: 0.9rem;">
                    <span>${cat}</span>
                    <span style="color: ${color}; font-weight: 700;">${perc}%</span>
                </div>
                <div style="height: 4px; background: var(--border); border-radius: 2px; margin-top: 4px;">
                    <div style="height: 100%; width: ${perc}%; background: ${color}; border-radius: 2px;"></div>
                </div>
            </div>
        `;
    }
}

function renderReview() {
    const list = document.getElementById('review-list');
    list.innerHTML = '';
    
    userAnswers.forEach((ans, idx) => {
        if (!ans.isCorrect) {
            const q = currentQuestions[ans.qIndex];
            const div = document.createElement('div');
            div.className = 'review-item';
            div.innerHTML = `
                <p style="font-weight: 700; margin-bottom: 8px;">${q.question}</p>
                <div class="explanation-box">
                    <strong>Explanation:</strong> ${q.explanation}
                </div>
            `;
            list.appendChild(div);
        }
    });
    
    if (list.innerHTML === '') list.innerHTML = '<p class="text-center">No mistakes! You mastered this set perfectly. 🌟</p>';
    showView('review');
}

// --- Event Listeners ---
const setupBtn = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.onclick = fn;
};

setupBtn('start-exam-btn', startExam);
setupBtn('start-study-btn', startStudy);
setupBtn('go-to-mistakes', loadMistakeBank);
setupBtn('mistakes-back-home', () => showView('home'));
setupBtn('go-to-import', () => showView('import'));
setupBtn('go-to-history', loadHistory);
setupBtn('history-back-home', () => showView('home'));
setupBtn('back-to-home', () => showView('home'));
setupBtn('view-review', renderReview);

const catSelect = document.getElementById('category-select');
if (catSelect) catSelect.onchange = updateCategoryPool;


async function loadMistakeBank() {
    showView('mistakes');
    const container = document.getElementById('mistakes-list');
    container.innerHTML = '<p class="text-center">Analyzing your struggles...</p>';
    
    const struggling = await DB.getStrugglingQuestions();
    container.innerHTML = '';
    
    if (struggling.length === 0) {
        container.innerHTML = '<p class="text-center">No mistakes found yet! Keep it up. 🌟</p>';
        return;
    }

    struggling.forEach(q => {
        const div = document.createElement('div');
        div.className = 'card';
        div.style.marginBottom = '12px';
        div.innerHTML = `
            <span class="category-tag">${q.category}</span>
            <p style="font-weight: 700; margin: 10px 0;">${q.question}</p>
            <div class="explanation-box" style="font-size: 0.85rem;">
                <strong>Explanation:</strong> ${q.explanation}
            </div>
            <div style="font-size: 0.75rem; color: var(--error); margin-top: 10px;">
                Mastery: ${q.masteryCount}/5 hits | Attempts: ${q.attempts}
            </div>
        `;
        container.appendChild(div);
    });
}

setupBtn('show-answer-btn', () => {
    document.getElementById('study-answer-area').classList.remove('hidden');
    document.getElementById('show-answer-btn').classList.add('hidden');
});
setupBtn('study-pass-btn', () => nextStudyCard(true));
setupBtn('study-fail-btn', () => nextStudyCard(false));
setupBtn('exit-study-btn', () => showView('home'));


async function startStudy() {
    const topic = document.getElementById('category-select').value;
    // We use the same source as Mastery Practice
    masteryUnits = await DB.getUnitsByTopic(topic);
    
    if (masteryUnits.length === 0) {
        alert("No units found to study. Please import your JSON first!");
        return;
    }
    
    masteryIndex = 0;
    showView('study');
    renderStudyCard();
}

function renderStudyCard() {
    const unit = masteryUnits[masteryIndex];
    document.getElementById('study-category').textContent = unit.category;
    document.getElementById('study-question').textContent = `Concept: ${unit.concept}`;
    
    // Detailed educational content
    const expBox = document.getElementById('study-explanation');
    
    // UNLOCK THE UNIT: When viewed in Flashcards, it becomes 'learning'
    if (unit.status === 'locked') {
        DB.updateUnitStatus(unit.id, 'learning').then(() => {
            unit.status = 'learning';
            DB.clearCache(); // Ensure next fetch gets the 'learning' status
        });
    }
    expBox.innerHTML = `
        <div style="margin-bottom: 15px;">
            <strong style="color: var(--primary);">Definition:</strong><br>
            ${unit.flashcard.definition}
        </div>
        <div style="margin-bottom: 15px;">
            <strong style="color: var(--warning);">Use Cases:</strong>
            <ul style="margin-top: 5px; padding-left: 18px; font-size: 0.9rem;">
                ${unit.flashcard.useCases.map(uc => `<li>${uc}</li>`).join('')}
            </ul>
        </div>
        <div>
            <strong style="color: var(--success);">ELI5 (Simple):</strong><br>
            <span style="font-style: italic; font-size: 0.9rem;">"${unit.flashcard.ELI5}"</span>
        </div>
    `;
    
    document.getElementById('study-answer-area').classList.add('hidden');
    document.getElementById('show-answer-btn').classList.remove('hidden');
}

async function nextStudyCard(isMasteryAction) {
    // If user clicks "Got it", we could optionally increment progress, 
    // but for now let's just move to the next card to study.
    masteryIndex++;
    if (masteryIndex < masteryUnits.length) {
        renderStudyCard();
    } else {
        alert("Study session complete!");
        showView('home');
        loadDashboard();
    }
}



function updateLiveStats() {
    const correct = userAnswers.filter(a => a.isCorrect).length;
    const wrong = userAnswers.filter(a => !a.isCorrect).length;
    const total = currentQuestions.length;
    const answered = userAnswers.length;
    const pending = total - answered;
    
    const currentPerc = answered > 0 ? Math.round((correct / answered) * 100) : 0;

    liveStats.correct.textContent = `OK: ${correct}`;
    liveStats.error.textContent = `ERR: ${wrong}`;
    liveStats.pending.textContent = `REM: ${pending}`;
    liveStats.perc.textContent = `${currentPerc}%`;
}

async function loadHistory() {
    showView('history');
    const container = document.getElementById('history-list');
    container.innerHTML = '<p class="text-center">Loading history...</p>';
    
    const history = await DB.getExamHistory();
    container.innerHTML = '';
    
    if (history.length === 0) {
        container.innerHTML = '<p class="text-center" style="color: var(--text-muted);">No exams completed yet.</p>';
        return;
    }

    history.forEach(item => {
        const color = item.percentage < 60 ? 'var(--error)' : (item.percentage < 85 ? 'var(--warning)' : 'var(--success)');
        const div = document.createElement('div');
        div.className = 'history-item';
        div.innerHTML = `
            <div>
                <div style="font-weight: 700;">${item.date}</div>
                <div style="font-size: 0.8rem; color: var(--text-muted);">${item.total} Questions</div>
            </div>
            <div class="history-score" style="background: ${color}20; color: ${color};">
                ${item.percentage}%
            </div>
        `;
        container.appendChild(div);
    });
}

setupBtn('import-submit', async () => {
    try {
        const text = document.getElementById('json-input').value;
        const json = JSON.parse(text);
        
        // Detect if it's Mastery Units or Regular Questions
        if (json.length > 0 && json[0].hardQuestion) {
            const count = await DB.saveMasteryUnits(json);
            DB.clearCache(); // Force re-fetch on next dashboard load
            alert(`Successfully imported ${count} Mastery units!`);
        } else {
            const count = await DB.saveQuestions(json);
            alert(`Successfully imported ${count} regular questions!`);
        }
        
        document.getElementById('json-input').value = '';
        showView('home');
        loadDashboard();
    } catch (e) {
        alert("Invalid JSON format. Please check your data.");
        console.error(e);
    }
});

// --- MASTERY PRACTICE LOGIC ---
let currentMasteryUnit = null;
let masteryUnits = [];
let masteryIndex = 0;

async function startMasteryPractice() {
    const topic = document.getElementById('category-select').value;
    let allUnits = await DB.getUnitsByTopic(topic);
    
    // FILTER: Only units that are NOT 'locked'
    // They must have been reviewed via Flashcards first
    masteryUnits = allUnits.filter(u => u.status !== 'locked' && u.status !== 'mastered');

    if (masteryUnits.length === 0) {
        const totalLockedInTopic = allUnits.filter(u => u.status === 'locked').length;
        if (totalLockedInTopic > 0) {
            alert(`You have ${totalLockedInTopic} units locked. Please study them via Flashcards first!`);
        } else {
            alert("No units to practice in this category.");
        }
        return;
    }
    
    // In "all", shuffle and pick limit
    if (topic === 'all') {
        masteryUnits = masteryUnits.sort(() => 0.5 - Math.random()).slice(0, 10);
    }

    masteryIndex = 0;
    showView('masteryPractice');
    renderMasteryScenario();
}

function renderMasteryScenario() {
    currentMasteryUnit = masteryUnits[masteryIndex];
    
    document.getElementById('mp-category').textContent = currentMasteryUnit.category;
    document.getElementById('mp-text').textContent = currentMasteryUnit.hardQuestion;
    document.getElementById('mp-answer').value = '';
    
    // Reset feedback area
    const feedbackArea = document.getElementById('mp-feedback-area');
    feedbackArea.classList.add('hidden');
    
    document.getElementById('mp-submit-btn').classList.remove('hidden');
    document.getElementById('mp-next-btn').classList.add('hidden');
}

async function submitMasteryAnswer() {
    const userAnswer = document.getElementById('mp-answer').value.trim();
    if (!userAnswer) return;

    const submitBtn = document.getElementById('mp-submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = "AI is thinking...";

    try {
        const result = await evaluateMastery(userAnswer, currentMasteryUnit);
        
        // Update DB
        await DB.updateUnitMastery(currentMasteryUnit.id, result.masteryIncrement);

        // Show Feedback
        const feedbackArea = document.getElementById('mp-feedback-area');
        const scoreBadge = document.getElementById('mp-score-badge');
        const feedbackText = document.getElementById('mp-feedback-text');
        const missingTerms = document.getElementById('mp-missing-terms');

        feedbackArea.classList.remove('hidden');
        scoreBadge.textContent = `Score: ${result.score}%`;
        scoreBadge.style.background = result.isCorrect ? 'var(--success)' : 'var(--error)';
        scoreBadge.style.color = 'black';
        
        feedbackText.textContent = result.feedback;
        
        if (result.missingTerms && result.missingTerms.length > 0) {
            missingTerms.textContent = `Missing terms: ${result.missingTerms.join(", ")}`;
        } else {
            missingTerms.textContent = '';
        }

        submitBtn.classList.add('hidden');
        document.getElementById('mp-next-btn').classList.remove('hidden');
    } catch (e) {
        alert("Error evaluating answer: " + e.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Validate with IA";
    }
}

setupBtn('start-mastery-btn', startMasteryPractice);
setupBtn('mp-submit-btn', submitMasteryAnswer);
setupBtn('mp-next-btn', () => {
    masteryIndex++;
    if (masteryIndex < masteryUnits.length) {
        renderMasteryScenario();
    } else {
        alert("Mastery session complete!");
        showView('home');
        location.reload(); // Refresh to see new mastery bars
    }
});
setupBtn('mp-exit-btn', () => showView('home'));


setupBtn('reset-stats', () => {
    if (confirm("Are you sure? This will delete all local scores and reset counts.")) {
        localStorage.removeItem('sf_scores');
        location.reload();
    }
});


// Initial Load
loadDashboard();
