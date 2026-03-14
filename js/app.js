import * as DB from './db.js';

// --- State Management ---
let currentQuestions = [];
let currentIndex = 0;
let userAnswers = []; // { qIndex, selectedIndices, isCorrect }
let timerInterval = null;
let timeLeft = 52.5 * 60; // 52 minutes and 30 seconds

// --- DOM Elements ---
const views = {
    home: document.getElementById('home-view'),
    import: document.getElementById('import-view'),
    exam: document.getElementById('exam-view'),
    history: document.getElementById('history-view'),
    study: document.getElementById('study-view'),
    results: document.getElementById('results-view'),
    review: document.getElementById('review-view')
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
    Object.values(views).forEach(v => v.classList.add('hidden'));
    views[viewName].classList.remove('hidden');
    
    if (viewName === 'exam') {
        document.getElementById('timer').classList.remove('hidden');
        liveStats.container.classList.remove('hidden');
    } else {
        document.getElementById('timer').classList.add('hidden');
        liveStats.container.classList.add('hidden');
    }
}


// --- Dashboard Logic ---
async function loadDashboard() {
    const stats = await DB.getDashboardStats();
    document.getElementById('total-questions').textContent = stats.total;
    document.getElementById('mastered-count').textContent = stats.mastered;
    
    // Populate Categories Dropdown
    const categories = await DB.getUniqueCategories();
    const catSelect = document.getElementById('category-select');
    // Keep the "All" option and add others
    catSelect.innerHTML = '<option value="all">All Categories (Mixed)</option>';
    categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
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
    const categories = await DB.getUniqueCategories();
    const container = document.getElementById('mastery-bars-container');
    container.innerHTML = '';

    for (const cat of categories) {
        const stats = await DB.getDashboardStats(cat);
        const masteryLevel = stats.total > 0 ? Math.round((stats.mastered / stats.total) * 100) : 0;
        
        const div = document.createElement('div');
        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 4px;">
                <span>${cat}</span>
                <span style="color: var(--primary); font-weight: 700;">${masteryLevel}% Mastered</span>
            </div>
            <div style="height: 6px; background: rgba(255,255,255,0.05); border-radius: 3px; overflow: hidden;">
                <div style="height: 100%; width: ${masteryLevel}%; background: var(--primary); transition: width 1s ease;"></div>
            </div>
        `;
        container.appendChild(div);
    }
}

async function updateCategoryPool() {
    const cat = document.getElementById('category-select').value;
    const stats = await DB.getDashboardStats(cat);
    document.getElementById('total-questions').textContent = stats.total;
    document.getElementById('mastered-count').textContent = stats.mastered;
}


// --- Exam Logic ---
async function startExam() {
    const lengthSelect = document.getElementById('exam-length-select');
    const mode = lengthSelect.value;
    const totalToFetch = mode === 'survival' ? 100 : (parseInt(lengthSelect.value) || 30);
    
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
        timeLeft = 0; // Infinite or just no timer
        document.getElementById('timer').classList.add('hidden');
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
    const correctAnswers = q.options.filter(o => o.isCorrect).map(o => o.text);
    const selectedAnswers = Array.from(selectedElements).map(el => el.querySelector('span').textContent);

    const isCorrect = correctAnswers.length === selectedAnswers.length && 
                      correctAnswers.every(val => selectedAnswers.includes(val));

    // UI Feedback
    document.querySelectorAll('.option-item').forEach(el => {
        const text = el.querySelector('span').textContent;
        if (correctAnswers.includes(text)) el.classList.add('correct');
        else if (selectedAnswers.includes(text)) el.classList.add('error');
    });

    userAnswers.push({ qIndex: currentIndex, isCorrect, explanation: q.explanation });

    // Update Live Stats
    updateLiveStats();

    // Update Mastery in DB
    await DB.updateMastery(q.id, isCorrect);

    // Survival Check
    const mode = document.getElementById('exam-length-select').value;
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
    
    // Save to Firestore History
    await DB.saveExamResult({
        score,
        total,
        percentage,
        date: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString()
    });

    document.getElementById('final-percentage').textContent = `${percentage}%`;
    document.getElementById('result-message').textContent = percentage >= 80 ? "Certified Ready! 🚀" : "Keep practicing, Trailblazer!";
    
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
document.getElementById('start-exam-btn').onclick = startExam;
document.getElementById('start-study-btn').onclick = startStudy;
document.getElementById('go-to-import').onclick = () => showView('import');
document.getElementById('go-to-history').onclick = loadHistory;
document.getElementById('history-back-home').onclick = () => showView('home');
document.getElementById('back-to-home').onclick = () => showView('home');
document.getElementById('view-review').onclick = renderReview;
document.getElementById('category-select').onchange = updateCategoryPool;
document.getElementById('show-answer-btn').onclick = () => {
    document.getElementById('study-answer-area').classList.remove('hidden');
    document.getElementById('show-answer-btn').classList.add('hidden');
};
document.getElementById('study-pass-btn').onclick = () => nextStudyCard(true);
document.getElementById('study-fail-btn').onclick = () => nextStudyCard(false);
document.getElementById('exit-study-btn').onclick = () => showView('home');

async function startStudy() {
    const cat = document.getElementById('category-select').value;
    currentQuestions = await DB.getExamQuestions(100, cat); // Get a lot for studying
    if (currentQuestions.length === 0) {
        alert("No questions to study!");
        return;
    }
    currentIndex = 0;
    showView('study');
    renderStudyCard();
}

function renderStudyCard() {
    const q = currentQuestions[currentIndex];
    document.getElementById('study-category').textContent = q.category;
    document.getElementById('study-question').textContent = q.question;
    document.getElementById('study-explanation').textContent = q.explanation;
    
    document.getElementById('study-answer-area').classList.add('hidden');
    document.getElementById('show-answer-btn').classList.remove('hidden');
}

async function nextStudyCard(isCorrect) {
    const q = currentQuestions[currentIndex];
    await DB.updateMastery(q.id, isCorrect);
    
    currentIndex++;
    if (currentIndex < currentQuestions.length) {
        renderStudyCard();
    } else {
        alert("Study session complete! You've gone through all available questions.");
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

document.getElementById('import-submit').onclick = async () => {

    try {
        const json = JSON.parse(document.getElementById('json-input').value);
        const count = await DB.saveQuestions(json);
        alert(`Successfully imported ${count} questions!`);
        document.getElementById('json-input').value = '';
        showView('home');
        loadDashboard();
    } catch (e) {
        alert("Invalid JSON format. Please check your data.");
    }
};

document.getElementById('reset-stats').onclick = () => {
    if (confirm("Are you sure? This will delete all local scores and reset counts.")) {
        localStorage.removeItem('sf_scores');
        location.reload();
    }
};

// Initial Load
loadDashboard();
