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
let dialogueHistory = [];
let localTutorHistories = new Map(); // questionId -> history array
let isChallengeFromFlashcard = false;
let currentTopicQuizCategory = null;
let currentMasteryUnit = null;
let masteryUnits = [];
let masteryIndex = 0;

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
    
    if (viewName === 'home') loadDashboard();
    
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

    renderGlobalMastery();
}

async function renderGlobalMastery() {
    const masteryStats = await DB.getExamMasteryProgress();
    const container = document.getElementById('mastery-bars-container');
    container.innerHTML = '';
    const mixedHeader = document.getElementById('mixed-quiz-header');
    mixedHeader.innerHTML = '';

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

    const masteredTopics = [];

    topics.forEach(cat => {
        const stats = masteryStats[cat] || { total: 0, mastered: 0, weight: 0, units: [] };
        const masteryPerc = stats.total > 0 ? Math.round((stats.mastered / stats.total) * 100) : 0;
        const isLoaded = stats.total > 0;
        
        if (masteryPerc === 100) masteredTopics.push(cat);
        const hasUnitFailures = stats.units.some(u => u.examFailures > 0);
        const showRedDot = masteryPerc === 100 && hasUnitFailures;
        
        const wrapper = document.createElement('div');
        wrapper.style.marginBottom = '12px';
        
        const masteryRow = document.createElement('div');
        masteryRow.className = 'mastery-row';
        masteryRow.style.opacity = isLoaded ? '1' : '0.4';
        masteryRow.innerHTML = `
            <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 6px;">
                <span>
                    <strong>${cat}</strong> 
                    <span style="color: var(--text-muted); font-size: 0.75rem;">(Weight: ${stats.weight || 0}%)</span>
                    ${stats.highScore > 0 ? `<span style="margin-left:8px; display: inline-block; padding: 2px 6px; background: rgba(0, 161, 224, 0.1); border: 1px solid var(--primary); border-radius: 4px; font-size: 0.6rem; color: var(--primary); font-weight: 800;">TOP: ${stats.highScore}%</span>` : ''}
                    ${showRedDot ? `<span style="margin-left: 8px; color: var(--error); font-size: 0.8rem;" title="False Mastery: Failures in Exams">🔴</span>` : ''}
                </span>
                <span style="color: var(--warning); font-weight: 700;">${masteryPerc}% Mastered</span>
            </div>
            <div style="height: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; overflow: hidden; margin-bottom: 4px; border: 1px solid ${isLoaded ? 'var(--warning)' : 'var(--border)'};">
                <div style="height: 100%; width: ${masteryPerc}%; background: linear-gradient(90deg, var(--warning), #ffcc00); transition: width 1s ease;"></div>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="font-size: 0.7rem; color: var(--text-muted);">
                    ${isLoaded ? `${stats.mastered} of ${stats.total} scenarios conquered` : 'No scenarios imported yet'}
                </div>
                <div style="display: flex; gap: 10px; align-items: center;">
                    ${masteryPerc === 100 ? `<button class="btn-primary" style="padding: 4px 10px; font-size: 0.65rem; background: var(--warning); color: black;" onclick="event.stopPropagation(); startTopicQuiz(event, '${cat}')">Final Quiz 🏆</button>` : ''}
                    ${isLoaded ? '<span style="font-size: 0.7rem; color: var(--primary); cursor: pointer;">View Details ▾</span>' : ''}
                </div>
            </div>
        `;

        if (isLoaded) {
            const detailsPanel = document.createElement('div');
            detailsPanel.className = 'details-panel';
            
            // Sort units: Mastered first or vice-versa? Let's show Mastered first but with clear distinction
            const sortedUnits = [...stats.units].sort((a, b) => {
                if (a.status === 'mastered' && b.status !== 'mastered') return 1;
                if (a.status !== 'mastered' && b.status === 'mastered') return -1;
                return 0;
            });

            detailsPanel.innerHTML = sortedUnits.map(u => `
                <div class="unit-detail-item">
                    <span>
                        <span class="status-dot ${u.status === 'mastered' ? 'status-mastered' : 'status-pending'}"></span>
                        ${u.concept} ${u.status === 'mastered' && u.examFailures > 0 ? `<span style="color: var(--error);" title="Mastered but failed in exam!">🔴</span>` : ''}
                    </span>
                    <span style="color: var(--text-muted); font-size: 0.7rem; opacity: 0.8;">
                        ${u.status === 'mastered' ? 'Mastered ✅' : 'In Progress'}
                    </span>
                </div>
            `).join('');

            // Attach click handlers to units
            detailsPanel.querySelectorAll('.unit-detail-item').forEach((el, idx) => {
                el.onclick = (e) => {
                    e.stopPropagation(); // Avoid closing the accordion row
                    const unit = sortedUnits[idx];
                    jumpToFlashcard(unit.id, unit.category);
                };
            });

            masteryRow.onclick = () => {
                detailsPanel.classList.toggle('open');
                const label = masteryRow.querySelector('span:last-child');
                if (label && label.textContent.includes('View')) {
                    label.textContent = detailsPanel.classList.contains('open') ? 'Hide Details ▴' : 'View Details ▾';
                }
            };
            
            wrapper.appendChild(masteryRow);
            wrapper.appendChild(detailsPanel);
        } else {
            wrapper.appendChild(masteryRow);
        }
        container.appendChild(wrapper);
    });

    // Handle Mixed Quiz Button
    if (masteredTopics.length >= 2) {
        const lastScore = masteryStats._mixed_?.lastScore;
        const scoreLabel = lastScore !== null && lastScore !== undefined ? `<br><span style="font-size: 0.7rem; opacity: 0.8;">LAST SCORE: ${lastScore}%</span>` : "";
        
        const mixedBtn = document.createElement('button');
        mixedBtn.className = 'btn-primary';
        mixedBtn.style.width = '100%';
        mixedBtn.style.background = 'linear-gradient(135deg, #00A1E0, #8E44AD)'; // Mixed gradient
        mixedBtn.style.color = 'white';
        mixedBtn.style.fontWeight = '800';
        mixedBtn.style.padding = '12px';
        mixedBtn.style.lineHeight = '1.2';
        mixedBtn.innerHTML = `🎓 START MIXED FINAL QUIZ (${masteredTopics.length} Topics)${scoreLabel}`;
        mixedBtn.onclick = (e) => startMixedTopicQuiz(e, masteredTopics);
        mixedHeader.appendChild(mixedBtn);
    }

    // Handle Weak Topics Quiz
    const weakUnitsCount = Object.values(masteryStats).reduce((acc, cat) => acc + (cat.units ? cat.units.filter(u => u.examFailures > 0).length : 0), 0);
    
    if (weakUnitsCount > 0) {
        const weakBtn = document.createElement('button');
        weakBtn.className = 'btn-primary';
        weakBtn.style.width = '100%';
        weakBtn.style.marginTop = '10px';
        weakBtn.style.background = 'linear-gradient(135deg, #e67e22, #c0392b)'; // Fire/Warning gradient
        weakBtn.style.color = 'white';
        weakBtn.style.fontWeight = '800';
        weakBtn.style.padding = '12px';
        weakBtn.innerHTML = `🔥 START WEAK CONCEPTS QUIZ (${weakUnitsCount} Concepts)`;
        weakBtn.onclick = (e) => startWeakTopicsQuiz(e);
        mixedHeader.appendChild(weakBtn);
    }
}

async function startTopicQuiz(event, topic) {
    const units = await DB.getUnitsByTopic(topic);
    if (units.length === 0) return;
    return runQuizGeneration(event.target, units, topic);
}

async function startMixedTopicQuiz(event, topics) {
    const btn = event.target;
    const allUnits = [];
    
    for (const topic of topics) {
        const units = await DB.getUnitsByTopic(topic);
        allUnits.push(...units);
    }

    if (allUnits.length === 0) return;
    return runQuizGeneration(btn, allUnits, "Mixed Mastery");
}

async function startWeakTopicsQuiz(event) {
    const btn = event.target;
    const stats = await DB.getExamMasteryProgress();
    const weakUnits = [];
    
    Object.values(stats).forEach(cat => {
        if (cat.units) {
            const failed = cat.units.filter(u => u.examFailures > 0);
            weakUnits.push(...failed);
        }
    });

    if (weakUnits.length === 0) return;
    return runQuizGeneration(btn, weakUnits, "Weak Concepts");
}

async function runQuizGeneration(btn, units, label) {
    const originalText = btn.textContent;
    btn.textContent = "Generating Quiz...";
    btn.disabled = true;

    try {
        currentTopicQuizCategory = label;
        // Optimization: if there are TOO many units (e.g. 100), maybe shuffle and pick a subset for the prompt
        // to stay within context limits and keep AI focused.
        const pool = units.length > 30 ? units.sort(() => 0.5 - Math.random()).slice(0, 30) : units;

        const result = await evaluateMastery(null, null, [], 'quiz_generation', { concepts: pool });
        if (Array.isArray(result)) {
            currentQuestions = result;
            currentIndex = 0;
            userAnswers = [];
            
            // Set a default timer for 10 questions (15 mins)
            timeLeft = 15 * 60;
            startTimer();
            
            showView('exam');
            updateLiveStats();
            renderQuestion();
        } else {
            const errorMsg = result.feedback || "Invalid quiz format received from AI.";
            throw new Error(errorMsg);
        }
    } catch (e) {
        console.error(e);
        alert("Error generating quiz: " + e.message);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

async function jumpToFlashcard(unitId, category) {
    const allUnits = await DB.getUnitsByTopic(category);
    const unitIndex = allUnits.findIndex(u => u.id === unitId);
    
    if (unitIndex === -1) return;

    // Set up study session beginning at this unit
    masteryUnits = allUnits;
    masteryIndex = unitIndex;
    
    showView('study');
    renderStudyCard();
}


async function updateCategoryPool() {
    const cat = document.getElementById('category-select').value;
    const stats = await DB.getDashboardStats(cat);
    const exp = await DB.getExperienceStats();

    document.getElementById('total-questions').textContent = stats.total;
    document.getElementById('mastered-count').textContent = stats.mastered;
    document.getElementById('study-streak').textContent = exp.streak;
    const minsToday = Math.floor(exp.timeToday / 60);
    document.getElementById('study-time-today').textContent = `${minsToday}m`;
}


// --- Exam Logic ---



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

    const imgContainer = document.getElementById('q-image-container');
    const qImg = document.getElementById('q-image');
    if (q.imageUrl) {
        qImg.src = q.imageUrl;
        imgContainer.classList.remove('hidden');
    } else {
        imgContainer.classList.add('hidden');
    }

    const optionsContainer = document.getElementById('q-options');
    optionsContainer.innerHTML = '';

    // Shuffle options al vuelo as requested
    const shuffledOptions = [...q.options].map((o, idx) => ({ ...o, originalIdx: idx }))
                                            .sort(() => 0.5 - Math.random());

    shuffledOptions.forEach((opt, idx) => {
        const div = document.createElement('div');
        div.className = 'option-item';
        div.innerHTML = `
            <div class="checkbox-visual ${!isMultiple ? 'radio-visual' : ''}"></div>
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
    const mode = 'standard';
    const correctAnswers = q.options.filter(o => o.isCorrect).map(o => o.text);
    const selectedAnswers = Array.from(selectedElements).map(el => el.querySelector('span').textContent);

    const isCorrect = correctAnswers.length === selectedAnswers.length && 
                      correctAnswers.every(val => selectedAnswers.includes(val));

    document.querySelectorAll('.option-item').forEach(el => {
        const text = el.querySelector('span').textContent;
        if (correctAnswers.includes(text)) el.classList.add('correct');
        else if (selectedAnswers.includes(text)) el.classList.add('error');
    });

    userAnswers.push({ 
        qIndex: currentIndex, 
        isCorrect, 
        explanation: q.explanation,
        selectedAnswers: selectedAnswers 
    });


    // Update Live Stats
    updateLiveStats();

    // Update Mastery in DB only if it's a permanent question (has an ID)
    if (q.id) {
        await DB.updateMastery(q.id, isCorrect);
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
    const mode = 'standard';
    
    // Save to Firestore History
    await DB.saveExamResult({
        score,
        total,
        percentage,
        mode,
        date: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString()
    });

    if (currentTopicQuizCategory) {
        const totalFailedCount = userAnswers.filter(a => !a.isCorrect).length;
        await DB.updateCategoryHighScore(currentTopicQuizCategory, percentage, totalFailedCount);
        
        // If there were failures, also attribute them to the specific concepts/units
        const failedQuestions = userAnswers.filter(a => !a.isCorrect);
        for (const ans of failedQuestions) {
            const q = currentQuestions[ans.qIndex];
            if (q.concept) {
                await DB.recordUnitExamFailure(q.concept, q.category);
            }
        }

        // Clean up successes
        const correctAnswers = userAnswers.filter(a => a.isCorrect);
        for (const ans of correctAnswers) {
            const q = currentQuestions[ans.qIndex];
            if (q.concept) {
                await DB.recordUnitExamSuccess(q.concept, q.category);
            }
        }

        currentTopicQuizCategory = null; 
    }

    document.getElementById('result-message').textContent = percentage >= 80 ? "Certified Ready! 🚀" : "Keep practicing, Trailblazer!";

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

    const failed = userAnswers.filter(a => !a.isCorrect);

    if (failed.length === 0) {
        list.innerHTML = '<p style="text-align: center; color: var(--success); padding: 20px; font-weight: 800;">Perfect score! Nothing to review! 🏆</p>';
    } else {
        failed.forEach((ans, idx) => {
            const q = currentQuestions[ans.qIndex];
            const div = document.createElement('div');
            div.className = 'card';
            div.style.marginBottom = '20px';
            div.style.background = 'rgba(255, 255, 255, 0.02)';
            div.style.borderLeft = '4px solid var(--error)';

            let optionsHtml = '';
            q.options.forEach(opt => {
                const wasSelected = (ans.selectedAnswers || []).includes(opt.text);
                const isCorrect = opt.isCorrect;
                
                let badge = '';
                let style = 'padding: 10px; border-radius: 8px; margin-bottom: 8px; font-size: 0.9rem; border: 1px solid transparent; transition: all 0.3s;';
                
                if (wasSelected && isCorrect) {
                     style += 'background: rgba(46, 204, 113, 0.15); border-color: var(--success); color: var(--success);';
                     badge = ' <span style="font-size: 0.7rem; font-weight: 800;">[CORRECT CHOICE] ✅</span>';
                } else if (wasSelected && !isCorrect) {
                     style += 'background: rgba(231, 76, 60, 0.15); border-color: var(--error); color: var(--error);';
                     badge = ' <span style="font-size: 0.7rem; font-weight: 800;">[YOUR INCORRECT CHOICE] ❌</span>';
                } else if (!wasSelected && isCorrect) {
                     style += 'background: rgba(255, 255, 255, 0.05); border-color: var(--warning); color: var(--warning);';
                     badge = ' <span style="font-size: 0.7rem; font-weight: 800;">[THIS WAS ALSO CORRECT] ⚠️</span>';
                } else {
                     style += 'opacity: 0.5; color: var(--text-muted);';
                }

                optionsHtml += `<div style="${style}">${opt.text} ${badge}</div>`;
            });

            div.innerHTML = `
                <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 10px; display: flex; justify-content: space-between;">
                    <span>Topic: ${q.category || 'General'}</span>
                    <span>Question ${ans.qIndex + 1}</span>
                </div>
                <h4 style="margin-bottom: 15px;">${q.question}</h4>
                <div style="margin-bottom: 20px;">
                    ${optionsHtml}
                </div>
                <div class="explanation-box" style="margin-top: 15px;">
                    <strong>Explanation:</strong><br>
                    ${q.explanation}
                </div>

                <!-- AI Tutor for this specific review item -->
                <div style="margin-top: 20px; border-top: 1px solid var(--border); padding-top: 15px;">
                    <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 10px;">Still confused? Ask the AI Tutor about this specific mistake:</p>
                    <div class="tutor-chat hidden" style="margin-bottom: 12px; padding: 12px; border-radius: 8px; background: rgba(0,0,0,0.2); font-size: 0.9rem; max-height: 200px; overflow-y: auto;"></div>
                    <div style="display: flex; gap: 8px;">
                        <input type="text" class="tutor-input" placeholder="Why is Option A wrong?" style="flex:1; background:rgba(0,0,0,0.3); border:1px solid var(--border); color:white; padding:8px; border-radius:6px; font-size:0.9rem;">
                        <button class="btn-outline tutor-ask-btn" style="padding:6px 12px; font-size:0.85rem;">Ask Tutor</button>
                    </div>
                </div>
            `;

            // Attach tutor logic
            const input = div.querySelector('.tutor-input');
            const chat = div.querySelector('.tutor-chat');
            const btn = div.querySelector('.tutor-ask-btn');
            
            btn.onclick = () => {
                const query = input.value.trim();
                if (!query) return;
                askTutor(query, q, chat, btn, input);
            };

            list.appendChild(div);
        });
    }
    
    showView('review');
}

// --- Event Listeners ---
const setupBtn = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.onclick = fn;
};


setupBtn('main-logo', () => showView('home'));
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
        div.style.marginBottom = '20px';
        div.innerHTML = `
            <span class="category-tag">${q.category}</span>
            <p style="font-weight: 700; margin: 10px 0;">${q.question}</p>
            <div class="explanation-box" style="font-size: 0.85rem; margin-bottom: 12px;">
                <strong>Explanation:</strong> ${q.explanation}
            </div>
            
            <!-- Tutor Chat for Mistake Bank -->
            <div style="border-top: 1px solid var(--border); padding-top: 15px; margin-top: 10px;">
                <div class="tutor-chat hidden" style="margin-bottom: 15px; padding: 12px; border-radius: 8px; background: rgba(255,255,255,0.05); font-size: 0.85rem; text-align: left; max-height: 200px; overflow-y: auto;"></div>
                <div style="display: flex; gap: 10px;">
                    <input type="text" class="tutor-input" style="flex: 1; background: rgba(0,0,0,0.2); border: 1px solid var(--border); border-radius: 8px; color: var(--text-main); padding: 8px 12px; font-size: 0.85rem;" placeholder="Deep dive into this concept...">
                    <button class="btn-outline tutor-ask-btn" style="padding: 8px 16px; font-size: 0.8rem;">Ask Tutor</button>
                </div>
            </div>

            <div style="font-size: 0.75rem; color: var(--error); margin-top: 15px; border-top: 1px solid var(--card-bg); padding-top: 5px;">
                Mastery Record: ${q.masteryCount}/5 hits | Total Attempts: ${q.attempts}
            </div>
        `;

        // Attach tutor logic
        const input = div.querySelector('.tutor-input');
        const chat = div.querySelector('.tutor-chat');
        const btn = div.querySelector('.tutor-ask-btn');
        
        btn.onclick = () => {
            const query = input.value.trim();
            if (!query) return;
            askTutor(query, q, chat, btn, input);
        };

        container.appendChild(div);
    });
}

setupBtn('show-answer-btn', () => {
    document.getElementById('study-answer-area').classList.remove('hidden');
    document.getElementById('show-answer-btn').classList.add('hidden');
    document.getElementById('skip-study-btn').classList.add('hidden');
    document.getElementById('prev-study-btn').classList.add('hidden');
});
setupBtn('prev-study-btn', () => {
    if (masteryIndex > 0) {
        masteryIndex--;
        renderStudyCard();
    }
});
setupBtn('study-next-btn', () => nextStudyCard(false));
setupBtn('study-challenge-btn', startFlashcardChallenge);
setupBtn('study-practice-btn', triggerPracticeChallenge);
setupBtn('skip-study-btn', () => nextStudyCard(false));
setupBtn('exit-study-btn', () => showView('home'));
setupBtn('study-ask-btn', askFlashcardTutor);

async function askFlashcardTutor() {
    const input = document.getElementById('study-tutor-input');
    const question = input.value.trim();
    if (!question) return;

    const chat = document.getElementById('study-tutor-chat');
    const btn = document.getElementById('study-ask-btn');
    const unit = masteryUnits[masteryIndex];

    askTutor(question, unit, chat, btn, input);
}

/**
 * GENERIC AI TUTOR LOGIC
 * Can be used for flashcards, post-exam review, or mistake bank
 */
async function askTutor(query, context, chatElement, btnElement, inputElement, showUserMsg = true) {
    btnElement.disabled = true;
    btnElement.textContent = "...";
    
    // UI Update
    chatElement.classList.remove('hidden');
    
    if (showUserMsg) {
        const userMsg = document.createElement('div');
        userMsg.style.marginBottom = '10px';
        userMsg.innerHTML = `<strong style="color: var(--primary);">You:</strong> ${query}`;
        chatElement.appendChild(userMsg);
        
        // Scroll to bottom
        chatElement.scrollTop = chatElement.scrollHeight;
    }

    if (inputElement) inputElement.value = '';

    // Manage Isolated History per question
    const historyId = context.id || context.question; // Use ID if available, fallback to question text
    if (!localTutorHistories.has(historyId)) {
        localTutorHistories.set(historyId, []);
    }
    const currentHistory = localTutorHistories.get(historyId);

    try {
        // ... (normalization)
        // [skipping normalization logic match in target content for brevity, using exact match below]
        
        let normalizedUnit = context;
        if (!context.concept && context.question) {
            normalizedUnit = {
                concept: context.question,
                referenceAnswer: context.explanation,
                category: context.category,
                keyTerms: []
            };
        } else if (context.flashcard) {
            normalizedUnit = {
                ...context,
                referenceAnswer: `${context.flashcard.definition}\n\nUse Cases: ${context.flashcard.useCases.join(', ')}\n\nELI5: ${context.flashcard.ELI5}`
            };
        }

        const result = await evaluateMastery(query, normalizedUnit, currentHistory, 'study');
        
        let feedbackContent = result.feedback || "The tutor is thinking, please try again.";
        if (typeof feedbackContent === 'object') {
            // Handle if AI returns a deeper JSON object for sections
            feedbackContent = Object.entries(feedbackContent).map(([k, v]) => `<strong>${k.toUpperCase()}:</strong> ${v}`).join('<br><br>');
        }
        
        // --- NEW: Markdown Cleanup (Double asterisks to <b>) ---
        feedbackContent = feedbackContent.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');

        // Add to history
        currentHistory.push({ role: 'user', content: query });
        currentHistory.push({ role: 'assistant', content: feedbackContent });

        // Add assistant reply to UI
        const assistantMsg = document.createElement('div');
        assistantMsg.style.marginBottom = '15px';
        assistantMsg.style.lineHeight = '1.5';
        assistantMsg.innerHTML = `<strong style="color: var(--warning);">Tutor:</strong><br>${feedbackContent.replace(/\n/g, '<br>')}`;
        chatElement.appendChild(assistantMsg);
        
        // Scroll to bottom
        chatElement.scrollTop = chatElement.scrollHeight;

    } catch (e) {
        console.error(e);
        const errDiv = document.createElement('div');
        errDiv.style.color = 'var(--error)';
        errDiv.style.fontSize = '0.75rem';
        errDiv.textContent = "Error: " + e.message;
        chatElement.appendChild(errDiv);
    } finally {
        btnElement.disabled = false;
        btnElement.textContent = "Ask Tutor";
    }
}

function startFlashcardChallenge() {
    isChallengeFromFlashcard = true;
    
    // Save flashcard session state globally (temp variables aren't enough)
    window._studyUnits = masteryUnits;
    window._studyIndex = masteryIndex;

    currentMasteryUnit = masteryUnits[masteryIndex];
    
    // Switch view
    showView('masteryPractice');
    
    // Setup for 1-unit Mastery session
    masteryUnits = [currentMasteryUnit];
    masteryIndex = 0;
    renderMasteryScenario();
}


async function startStudy() {
    const topic = document.getElementById('category-select').value;
    let allUnits = await DB.getUnitsByTopic(topic);
    
    masteryUnits = allUnits;
    
    if (masteryUnits.length === 0) {
        alert("No units found matching your criteria.");
        return;
    }

    // ALWAYS SHUFFLE
    masteryUnits = masteryUnits.sort(() => 0.5 - Math.random());
    
    masteryIndex = 0;
    showView('study');
    renderStudyCard();
}

function renderStudyCard() {
    const unit = masteryUnits[masteryIndex];
    
    // Update Counter in UI
    const topic = unit.category;
    DB.getUnitsByTopic(topic).then(all => {
        const masteredCount = all.filter(u => u.status === 'mastered').length;
        document.getElementById('study-category').textContent = `${unit.category} | Mastered: ${masteredCount} / ${all.length}`;
    });

    const statusIcon = unit.status === 'mastered' 
        ? '<span class="status-dot status-mastered" title="Mastered" style="margin-left: 10px; margin-right: 0;"></span>' 
        : '';
    document.getElementById('study-question').innerHTML = `Concept: ${unit.concept} ${statusIcon}`;
    
    const expBox = document.getElementById('study-explanation');
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
        <div id="admin-blueprint-area" style="margin-top: 20px; padding-top: 15px; border-top: 1px dashed var(--border);">
            <button class="btn-outline" style="width: 100%; font-size: 0.8rem; border-color: var(--warning); color: var(--warning);" onclick="triggerDeepDive(event)">
                🧭 Unlock Admin Blueprint (Setup & Limits)
            </button>
        </div>
    `;

    const imgContainer = document.getElementById('study-image-container');
    const sImg = document.getElementById('study-image');
    if (unit.imageUrl) {
        sImg.src = unit.imageUrl;
        imgContainer.classList.remove('hidden');
    } else {
        imgContainer.classList.add('hidden');
    }
    
    document.getElementById('study-answer-area').classList.remove('hidden');

    const prevBtn = document.getElementById('prev-study-btn');
    if (masteryIndex === 0) {
        prevBtn.classList.add('hidden');
    } else {
        prevBtn.classList.remove('hidden');
    }
    
    // Reset Tutor Chat
    document.getElementById('study-tutor-chat').innerHTML = '';
    document.getElementById('study-tutor-chat').classList.add('hidden');
    document.getElementById('study-tutor-input').value = '';
}

async function nextStudyCard(isMasteryAction) {
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




setupBtn('reset-stats', () => {
    const confirmation = prompt("⚠️ ATTENTION: This will reset all your progress and stats.\nIF YOU ARE SURE, TYPE 'BORRAR' BELOW:");
    if (confirmation === 'BORRAR') {
        localStorage.removeItem('sf_scores');
        alert("Stats reset. Reloading...");
        location.reload();
    }
});


// Initial Load
loadDashboard();

window.startTopicQuiz = startTopicQuiz;

async function triggerDeepDive(event) {
    const unit = masteryUnits[masteryIndex];
    if (!unit) return;
    const btn = event ? event.currentTarget || event.target : null;
    const chat = document.getElementById('study-tutor-chat');
    const input = document.getElementById('study-tutor-input');
    
    if (btn) {
        btn.disabled = true;
        btn.textContent = "🧭 Exploring Technical Specs...";
    }
    
    const query = "Generate the Full Administrative Blueprint for this concept. Be ULTRA CONCISE and SURGICAL. Use Arrow Path for Setup. Exactly 3 points for Workflow, 3 numbers for Limits. NO INTROS. NO CONCEPT SECTION. NO ASTERISKS (**).";
    await askTutor(query, unit, chat, btn || {}, input, false);
    
    if (btn) {
        btn.textContent = "🧭 Blueprint Unlocked!";
    }
}
async function triggerPracticeChallenge(event) {
    const unit = masteryUnits[masteryIndex];
    if (!unit) return;
    const btn = event ? event.currentTarget || event.target : null;
    const chat = document.getElementById('study-tutor-chat');
    const input = document.getElementById('study-tutor-input');
    
    if (btn) {
        btn.disabled = true;
        btn.textContent = "🛠️ Designing Hands-on Task...";
    }
    
    const query = "Generate a short, surgical 'Practice in your Org' challenge for this concept. Tell me EXACTLY what to build in my Salesforce Developer Edition to prove I master this. NO STEPS, just the REQUIREMENT. Keep it challenging but quick to verify.";
    await askTutor(query, unit, chat, btn || {}, input, false);
    
    if (btn) {
        btn.textContent = "🛠️ Practice Task Ready!";
    }
}
window.triggerPracticeChallenge = triggerPracticeChallenge;

window.triggerDeepDive = triggerDeepDive;

window.showImageFull = (src) => {
    const modal = document.getElementById('image-modal');
    const modalImg = document.getElementById('modal-img');
    modalImg.src = src;
    modal.classList.remove('hidden');
};

// --- MASTERY PRACTICE LOGIC ---
setupBtn('mp-submit-btn', submitMasteryAnswer);
setupBtn('mp-next-btn', () => {
    if (isChallengeFromFlashcard) {
        isChallengeFromFlashcard = false;
        // Restore Flashcard Session
        masteryUnits = window._studyUnits;
        masteryIndex = window._studyIndex;
        
        DB.getUnitsByTopic(currentMasteryUnit.category).then(all => {
            const updatedUnit = all.find(u => u.id === currentMasteryUnit.id);
            showView('study');
            if (updatedUnit.status === 'mastered') {
                nextStudyCard(false);
            } else {
                renderStudyCard();
            }
        });
        return;
    }
    masteryIndex++;
    if (masteryIndex < masteryUnits.length) {
        renderMasteryScenario();
    } else {
        alert("Mastery session complete!");
        showView('home');
        location.reload(); 
    }
});
setupBtn('mp-exit-btn', () => {
    if (isChallengeFromFlashcard) {
        isChallengeFromFlashcard = false;
        masteryUnits = window._studyUnits;
        masteryIndex = window._studyIndex;
        showView('study');
        renderStudyCard();
    } else {
        showView('home');
    }
});

function renderMasteryScenario() {
    currentMasteryUnit = masteryUnits[masteryIndex];
    dialogueHistory = []; // Reset dialogue for new scenario
    
    // Update Counter in UI
    const topic = document.getElementById('category-select')?.value || currentMasteryUnit.category;
    DB.getUnitsByTopic(topic).then(all => {
        const masteredCount = all.filter(u => u.status === 'mastered').length;
        document.getElementById('mp-category').textContent = `${currentMasteryUnit.category} | Mastered: ${masteredCount} / ${all.length}`;
    });

    document.getElementById('mp-text').textContent = currentMasteryUnit.hardQuestion;
    document.getElementById('mp-answer').value = '';
    document.getElementById('mp-answer').placeholder = "Explain your setup here...";
    
    // Reset feedback area
    const feedbackArea = document.getElementById('mp-feedback-area');
    feedbackArea.classList.add('hidden');
    
    document.getElementById('mp-submit-btn').classList.remove('hidden');
    document.getElementById('mp-submit-btn').textContent = "Validate with IA";
    document.getElementById('mp-give-up-btn').classList.remove('hidden');
    document.getElementById('mp-next-btn').classList.add('hidden');
    document.getElementById('mp-retry-btn').classList.add('hidden');

    const imgContainer = document.getElementById('mp-image-container');
    const mImg = document.getElementById('mp-image');
    if (currentMasteryUnit.imageUrl) {
        mImg.src = currentMasteryUnit.imageUrl;
        imgContainer.classList.remove('hidden');
    } else {
        imgContainer.classList.add('hidden');
    }
}

async function submitMasteryAnswer() {
    const userAnswer = document.getElementById('mp-answer').value.trim();
    if (!userAnswer) return;

    const submitBtn = document.getElementById('mp-submit-btn');
    submitBtn.disabled = true;
    const isContinuing = dialogueHistory.length > 0;
    submitBtn.textContent = isContinuing ? "Tutor is thinking..." : "AI is evaluating mastery...";

    try {
        const result = await evaluateMastery(userAnswer, currentMasteryUnit, dialogueHistory, 'mastery');
        
        // Add to history
        dialogueHistory.push({ role: 'user', content: userAnswer });
        dialogueHistory.push({ role: 'assistant', content: result.feedback });

        // Update DB ONLY if 100% on FIRST attempt
        if (!isContinuing && result.masteryIncrement) {
             await DB.updateUnitMastery(currentMasteryUnit.id, true);
             currentMasteryUnit.status = 'mastered'; // Update local state for immediate UI feedback
        }

        // Show Feedback
        const feedbackArea = document.getElementById('mp-feedback-area');
        const scoreBadge = document.getElementById('mp-score-badge');
        const feedbackText = document.getElementById('mp-feedback-text');

        feedbackArea.classList.remove('hidden');
        scoreBadge.textContent = `Score: ${result.score}%`;
        
        if (result.score === 100) {
            scoreBadge.style.background = 'var(--success)';
            submitBtn.classList.add('hidden');
            document.getElementById('mp-next-btn').classList.remove('hidden');
        } else {
            scoreBadge.style.background = 'var(--warning)';
            submitBtn.textContent = "Send to Tutor";
            document.getElementById('mp-answer').value = ''; // Clear for next reply
            document.getElementById('mp-answer').placeholder = "Follow-up with the Tutor here...";
        }
        scoreBadge.style.color = 'black';
        feedbackText.textContent = result.feedback;

    } catch (e) {
        alert("Error evaluating answer: " + e.message);
    } finally {
        submitBtn.disabled = false;
    }
}

setupBtn('mp-give-up-btn', () => {
    if (!currentMasteryUnit) return;
    
    const feedbackArea = document.getElementById('mp-feedback-area');
    const feedbackText = document.getElementById('mp-feedback-text');
    const scoreBadge = document.getElementById('mp-score-badge');
    
    feedbackArea.classList.remove('hidden');
    scoreBadge.textContent = "Given Up";
    scoreBadge.style.background = 'var(--text-muted)';
    
    feedbackText.innerHTML = `
        <div style="margin-top: 10px; padding: 10px; background: rgba(0,0,0,0.2); border-left: 3px solid var(--primary);">
            <strong style="color: var(--primary);">Reference Answer:</strong><br>
            ${currentMasteryUnit.referenceAnswer}
        </div>
        <p style="margin-top: 10px; font-size: 0.9rem; color: var(--text-muted);">This unit remains unmastered. Try again later!</p>
    `;
    
    document.getElementById('mp-submit-btn').classList.add('hidden');
    document.getElementById('mp-give-up-btn').classList.add('hidden');
    document.getElementById('mp-retry-btn').classList.remove('hidden');
    document.getElementById('mp-next-btn').classList.remove('hidden');
});

setupBtn('mp-retry-btn', renderMasteryScenario);
