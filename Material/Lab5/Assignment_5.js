// manifest.json
{
  "manifest_version": 3,
  "name": "AI Meeting Assistant",
  "version": "1.0",
  "permissions": ["activeTab", "scripting"],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_title": "Open AI Assistant"
  }
}

// background.js
chrome.action.onClicked.addListener((tab) => {

  chrome.scripting.insertCSS({
    target: { tabId: tab.id },
    files: ["style.css"]
  });

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content.js"]
  });

});

/* style.css */
#ai-panel {
  position: fixed;
  right: 0;
  top: 0;
  width: 360px;
  height: 100vh;
  background: #f8f9fa;
  border-left: 2px solid #ccc;
  padding: 16px;
  font-family: Arial, sans-serif;
  z-index: 999999;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.row {
  display: flex;
  gap: 8px;
}

button {
  flex: 1;
  padding: 8px;
  border: none;
  border-radius: 6px;
  background: #4f46e5;
  color: white;
  cursor: pointer;
}

button:disabled {
  background: #999;
  cursor: not-allowed;
}

.box {
  border: 1px solid #ccc;
  background: white;
  height: 120px;
  overflow-y: auto;
  padding: 8px;
  white-space: pre-wrap;
  border-radius: 6px;
}

/* MODAL POPUP */
#qa-modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0,0,0,0.4);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000000;
}

#qa-content {
  background: white;
  width: 400px;
  padding: 20px;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* TODO: Add styling for a "comparison view" (side-by-side or tabbed)
   showing requirements WITHOUT clarification vs WITH clarification,
   and for displaying evaluation metric results. */

// content.js
// ==============================
// Prevent double injection
// ==============================
if (window.__AI_PANEL_LOADED__) {

} else {
  window.__AI_PANEL_LOADED__ = true;

  // ==============================
  // Layout Fix (shrink page)
  // ==============================
  document.documentElement.style.width = "calc(100% - 360px)";
  document.documentElement.style.overflowX = "hidden";

  // ==============================
  // CONFIG
  // ==============================
  const GROQ_API_KEY = "";
  const QUESTION_INTERVAL = 30000; // 30 seconds

  // ==============================
  // PANEL UI
  // ==============================
  const panel = document.createElement("div");
  panel.id = "ai-panel";

  panel.innerHTML = `
<h2>🎙 AI Meeting Assistant</h2>

<div class="row">
  <button id="startBtn">Start</button>
  <button id="stopBtn" disabled>Stop</button>
</div>

<select id="modeSelect">
  <option value="manual">Manual Questions</option>
  <option value="auto">Auto Questions (30s)</option>
</select>

<h4>Transcript</h4>
<div id="transcriptBox" class="box"></div>

<button id="qBtn">Generate Questions</button>

<button id="genBtn">Generate Requirements</button>

<!-- TODO: Add a button/section to also generate requirements
     WITHOUT clarification (straight from transcript), so both
     versions can be compared. -->

<!-- TODO: Add a button to run evaluation and display a
     comparison of requirement quality (with vs without
     clarification). -->

<div id="statusBox"></div>
<button id="downloadBtn" style="display:none">Download Requirements</button>
`;

  document.body.appendChild(panel);

  // ==============================
  // STATE
  // ==============================
  let recognition;
  let transcript = "";
  let questions = [];
  let askedQuestions = [];
  let currentIndex = 0;
  let qaPairs = [];
  let autoTimer = null;
  let isAsking = false;
  let finalRequirements = "";

  // TODO: Add state for the "without clarification" baseline
  // requirements, so it can be generated and stored separately
  // e.g. let baselineRequirements = "";

  // ==============================
  // SPEECH RECOGNITION
  // ==============================
  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");

  function startRecognition() {

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {

      if (isAsking) return;

      let interim = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          transcript += event.results[i][0].transcript + " ";
        } else {
          interim += event.results[i][0].transcript;
        }
      }

      document.getElementById("transcriptBox").innerText =
        transcript + interim;
    };

    recognition.start();
  }

  startBtn.onclick = () => {

    startRecognition();
    startBtn.disabled = true;
    stopBtn.disabled = false;

    if (document.getElementById("modeSelect").value === "auto") {
      autoTimer = setInterval(() => {
        if (!isAsking) generateQuestions();
      }, QUESTION_INTERVAL);
    }
  };

  stopBtn.onclick = () => {

    recognition.stop();
    startBtn.disabled = false;
    stopBtn.disabled = true;

    if (autoTimer) clearInterval(autoTimer);
  };

  // ==============================
  // GROQ API CALL
  // ==============================
  async function callGroq(prompt) {

    const res = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + GROQ_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [{ role: "user", content: prompt }]
        })
      }
    );

    const data = await res.json();
    return data.choices[0].message.content;
  }

  // ==============================
  // PROMPTS
  // ==============================
  function questionPrompt(t) {
    return `
You are a senior requirements engineer.
Generate 5 clarification questions.
Do NOT repeat previous ones.

Transcript:
${t}

Already Asked:
${askedQuestions.join("\n")}
`;
  }

  function frPrompt(t, qa) {
    return `
Transcript:
${t}

Questions & Answers:
${qa}

Generate:
- Functional Requirements
- Non-Functional Requirements

Use bullet points.
`;
  }

  // TODO: Write a prompt that generates FR/NFR directly from the
  // transcript WITHOUT using any clarification Q&A. This is the
  // "baseline" requirements needed for the with/without comparison.
  function baselinePrompt(t) {
    return `
// TODO: instruct the LLM to extract Functional and Non-Functional
// Requirements directly from ${t}, with no clarification support.
`;
  }

  // TODO: Write a prompt that categorizes NFRs from a requirements
  // block into categories such as Security, Performance, Reliability,
  // Fairness, etc.
  function nfrCategoryPrompt(requirements) {
    return `
// TODO: instruct the LLM to group NFRs found in ${requirements}
// under appropriate categories.
`;
  }

  // TODO: Write a prompt (or implement a simple heuristic) that
  // evaluates and scores requirement quality — e.g. completeness,
  // clarity, number of ambiguous terms — for both the baseline and
  // clarified requirements, so they can be compared.
  function evaluationPrompt(baseline, refined) {
    return `
// TODO: instruct the LLM to compare ${baseline} vs ${refined} on
// suitable quality metrics (e.g. completeness, clarity, specificity)
// and return a structured comparison.
`;
  }

  // ==============================
  // GENERATE QUESTIONS
  // ==============================
  document.getElementById("qBtn").onclick = () => {
    generateQuestions();
  };

  async function generateQuestions() {

    isAsking = true;

    recognition.stop();
    if (autoTimer) clearInterval(autoTimer);

    const res = await callGroq(questionPrompt(transcript));

    questions = res.split("\n")
      .filter(q => q.trim() && q[0].match(/[0-9]/));

    currentIndex = 0;
    openQuestionModal();
  }

  // ==============================
  // GENERATE REQUIREMENTS (WITH CLARIFICATION)
  // ==============================
  document.getElementById("genBtn").onclick = async () => {

    if (transcript.trim().length === 0) {
      alert("Transcript is empty. Start transcription first.");
      return;
    }

    if (qaPairs.length === 0) {
      alert("No questions answered yet.");
      return;
    }

    document.getElementById("statusBox")
      .innerText = "⏳ Generating requirements...";

    let qaText = "";

    qaPairs.forEach(p => {
      qaText += `Q: ${p.q}\nA: ${p.a}\n\n`;
    });

    try {

      finalRequirements = await callGroq(
        frPrompt(transcript, qaText)
      );

      // TODO: Also call baselinePrompt() to generate the "without
      // clarification" version (if not already generated), then
      // call evaluationPrompt() to compare the two and render the
      // comparison in the panel.

      // TODO: Call nfrCategoryPrompt() on finalRequirements and
      // display the categorized NFRs.

      document.getElementById("statusBox")
        .innerText = "✅ Requirements generated successfully";

      document.getElementById("downloadBtn")
        .style.display = "block";

    } catch (e) {

      console.error(e);

      document.getElementById("statusBox")
        .innerText = "❌ Failed to generate requirements";

    }
  };

  // TODO: Add a handler (e.g. for a new "Generate Baseline" button)
  // that calls callGroq(baselinePrompt(transcript)) directly from the
  // raw transcript, with no clarification step, and stores the result
  // for later comparison.

  // ==============================
  // DOWNLOAD FILE
  // ==============================
  document.getElementById("downloadBtn").onclick = () => {

    const blob = new Blob([finalRequirements],
      { type: "text/plain" });

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "requirements.txt";
    a.click();
  };

  // TODO: Extend export to support PDF and DOCX formats (e.g. using
  // a client-side library, or by sending content to a small backend
  // that generates the file), in addition to the current TXT export.
  // TODO: Also allow exporting the evaluation/comparison report.

  // ==============================
  // MODAL QUESTION POPUP
  // ==============================
  function openQuestionModal() {

    const modal = document.createElement("div");
    modal.id = "qa-modal";

    modal.style.position = "fixed";
    modal.style.top = "0";
    modal.style.left = "0";
    modal.style.width = "100%";
    modal.style.height = "100%";
    modal.style.background = "rgba(0,0,0,0.4)";
    modal.style.display = "flex";
    modal.style.justifyContent = "center";
    modal.style.alignItems = "center";
    modal.style.zIndex = "1000000";

    modal.innerHTML = `
    <div style="background:white;padding:20px;width:400px;border-radius:8px">
      <h3>Clarification Question</h3>
      <div id="modalQuestion"></div>
      <input id="modalAnswer" style="width:100%" placeholder="Type answer">
      <br><br>
      <button id="modalNextBtn">Save & Next</button>
    </div>
  `;

    document.body.appendChild(modal);

    showModalQuestion();

    document.getElementById("modalNextBtn").onclick = () => {

      const ans = document.getElementById("modalAnswer").value;

      qaPairs.push({
        q: questions[currentIndex],
        a: ans
      });

      askedQuestions.push(questions[currentIndex]);
      currentIndex++;

      if (currentIndex >= questions.length) {
        document.body.removeChild(modal);
        resumeAfterQuestions();
      } else {
        showModalQuestion();
      }
    };
  }

  function showModalQuestion() {
    document.getElementById("modalQuestion")
      .innerText = questions[currentIndex];

    document.getElementById("modalAnswer").value = "";
  }

  function resumeAfterQuestions() {

    isAsking = false;
    startRecognition();

    if (document.getElementById("modeSelect").value === "auto") {
      autoTimer = setInterval(() => {
        if (!isAsking) generateQuestions();
      }, QUESTION_INTERVAL);
    }
  }
}

