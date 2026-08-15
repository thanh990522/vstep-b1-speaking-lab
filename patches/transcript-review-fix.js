/* VSTEP Speaking Lab — hidden dual transcript + post-score annotated review */
(() => {
  'use strict';

  const q = (s) => document.querySelector(s);
  const legacyTranscript = q('#transcript');
  const micButton = q('#micBtn');
  const feedbackCard = q('#feedback');
  if (!legacyTranscript || !micButton || !feedbackCard) return;

  // ----- Presentation: transcript stays hidden until scoring is complete -----
  function hideLegacyTranscript() {
    legacyTranscript.style.display = 'none';
    const heading = legacyTranscript.previousElementSibling;
    if (heading && heading.classList.contains('section-heading')) heading.style.display = 'none';
  }
  hideLegacyTranscript();

  const style = document.createElement('style');
  style.textContent = `
    #transcriptReviewCard{display:none;margin-top:14px;overflow:hidden}
    #transcriptReviewCard.show{display:block;animation:txReveal .42s ease both}
    @keyframes txReveal{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
    .tx-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}
    .tx-head h2{font-size:17px;margin:0}.tx-head p{font-size:11px;color:var(--muted);margin:4px 0 0;line-height:1.45}
    .tx-source{font-size:10px;font-weight:900;padding:6px 9px;border-radius:999px;background:#eef2ff;color:#4338ca;white-space:nowrap}
    .tx-legend{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 12px}
    .tx-legend span,.tx-chip{font-size:10px;font-weight:850;border-radius:999px;padding:5px 8px;border:1px solid transparent}
    .tx-g{background:#fff1f2;color:#be123c;border-color:#fecdd3!important}.tx-v{background:#f5f3ff;color:#6d28d9;border-color:#ddd6fe!important}
    .tx-p{background:#fff7ed;color:#c2410c;border-color:#fed7aa!important}.tx-f{background:#fffbeb;color:#a16207;border-color:#fde68a!important}
    .tx-d{background:#ecfdf5;color:#047857;border-color:#a7f3d0!important}
    .tx-script{background:#fbfcff;border:1px solid var(--line);border-radius:16px;padding:14px}
    .tx-line{padding:10px 0;border-bottom:1px dashed #e5e7eb;line-height:1.82;font-size:14px}.tx-line:last-child{border-bottom:0}
    .tx-mark{border-radius:5px;padding:1px 3px;font-weight:750}.tx-mark.v{background:#ede9fe;color:#6d28d9}.tx-mark.f{background:#fef3c7;color:#92400e}
    .tx-mark.d{background:#d1fae5;color:#065f46}.tx-mark.p{border-bottom:2px solid #fb923c;background:#fff7ed;color:#9a3412}
    .tx-fix{display:block;margin-top:7px;padding:8px 10px;border-radius:10px;font-size:11px;line-height:1.5}
    .tx-fix.g{background:#fff1f2;color:#9f1239;border-left:3px solid #e11d48}.tx-fix.v{background:#f5f3ff;color:#5b21b6;border-left:3px solid #7c3aed}
    .tx-fix.d{background:#ecfdf5;color:#065f46;border-left:3px solid #10b981}.tx-fix.f{background:#fffbeb;color:#92400e;border-left:3px solid #f59e0b}
    .tx-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}.tx-summary>div{border:1px solid var(--line);border-radius:12px;padding:10px;background:white}
    .tx-summary b{font-size:11px;display:block;margin-bottom:5px}.tx-summary p{font-size:10px;color:var(--muted);line-height:1.5;margin:0}
    @media(max-width:650px){.tx-head{display:block}.tx-source{display:inline-block;margin-top:8px}.tx-summary{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  const review = document.createElement('section');
  review.id = 'transcriptReviewCard';
  review.className = 'card';
  feedbackCard.insertAdjacentElement('afterend', review);

  function resetReview() {
    review.classList.remove('show');
    review.innerHTML = '';
    hideLegacyTranscript();
    legacyTranscript.value = '';
  }

  // Reset transcript review when the student changes question/part.
  if (typeof render === 'function') {
    const baseRender = render;
    render = function(...args) {
      resetReview();
      return baseRender.apply(this, args);
    };
  }

  // ----- Dual speech recognition: hidden live fallback + file Whisper fallback -----
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  let recognition = null;
  let liveFinal = '';
  let liveInterim = '';
  let recognitionWanted = false;
  let recognitionStarted = false;

  function normalizedTranscript(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function transcriptWordCount(text) {
    const m = normalizedTranscript(text).match(/[A-Za-z]+(?:'[A-Za-z]+)?/g);
    return m ? m.length : 0;
  }

  function liveTranscript() {
    return normalizedTranscript(`${liveFinal} ${liveInterim}`);
  }

  function buildRecognition() {
    if (!Recognition) return null;
    const r = new Recognition();
    r.lang = 'en-US';
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onstart = () => { recognitionStarted = true; };
    r.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i]?.[0]?.transcript || '';
        if (event.results[i].isFinal) liveFinal += ` ${text}`;
        else interim += ` ${text}`;
      }
      liveInterim = interim;
    };
    r.onerror = (event) => {
      console.warn('Live speech recognition fallback:', event.error || event);
      if (['not-allowed','service-not-allowed','audio-capture'].includes(event.error)) recognitionWanted = false;
    };
    r.onend = () => {
      recognitionStarted = false;
      if (recognitionWanted && typeof mediaRecorder !== 'undefined' && mediaRecorder?.state === 'recording') {
        setTimeout(() => { try { r.start(); } catch {} }, 220);
      }
    };
    return r;
  }

  function startHiddenRecognition() {
    liveFinal = '';
    liveInterim = '';
    recognitionWanted = true;
    if (!Recognition) return;
    recognition = buildRecognition();
    try { recognition.start(); } catch (err) { console.warn('Recognition start failed:', err); }
  }

  function stopHiddenRecognition() {
    recognitionWanted = false;
    if (!recognition) return;
    try { recognition.stop(); } catch {}
  }

  // Wrap the final robust microphone handler. Start recognition only after MediaRecorder is actually running.
  const baseMicClick = micButton.onclick;
  micButton.onclick = async function(event) {
    const wasRecording = typeof mediaRecorder !== 'undefined' && mediaRecorder?.state === 'recording';
    if (wasRecording) stopHiddenRecognition();
    const out = await baseMicClick.call(this, event);
    if (!wasRecording && typeof mediaRecorder !== 'undefined' && mediaRecorder?.state === 'recording') {
      startHiddenRecognition();
    }
    return out;
  };

  // Keep the legacy textarea hidden even if old code writes into it.
  const baseAnalyzeRealAudio = analyzeRealAudio;
  analyzeRealAudio = async function(...args) {
    hideLegacyTranscript();
    await new Promise(r => setTimeout(r, 260));

    // Fast path: speech recognition captured the same microphone attempt while MediaRecorder was running.
    let live = liveTranscript();
    if (transcriptWordCount(live) >= 2) {
      realAudio.transcript = live;
      realAudio.asr = { text: live, chunks: [] };
      realAudio.analyzed = true;
      realAudio.transcriptSource = 'Browser Speech Recognition';
      legacyTranscript.value = '';
      if (typeof setAIProgress === 'function') setAIProgress(100);
      if (typeof setAIStatus === 'function') setAIStatus(`Đã nhận diện ${transcriptWordCount(live)} từ. Transcript được giữ ẩn cho đến sau khi chấm điểm.`, 'ok');
      return true;
    }

    // Fallback: original Whisper pipeline reads the saved audio file.
    try { await baseAnalyzeRealAudio.apply(this, args); } catch (err) { console.warn('Whisper fallback threw:', err); }
    hideLegacyTranscript();
    if (realAudio.analyzed && transcriptWordCount(realAudio.transcript) >= 2) {
      realAudio.transcriptSource = 'Whisper from saved audio';
      legacyTranscript.value = '';
      return true;
    }

    // One last late live result may arrive just after recognition.stop().
    await new Promise(r => setTimeout(r, 500));
    live = liveTranscript();
    if (transcriptWordCount(live) >= 2) {
      realAudio.transcript = live;
      realAudio.asr = { text: live, chunks: [] };
      realAudio.analyzed = true;
      realAudio.transcriptSource = 'Browser Speech Recognition';
      legacyTranscript.value = '';
      return true;
    }
    return false;
  };

  // ----- Annotated transcript after score -----
  const grammarRules = [
    {re:/\bi very like\b/ig, fix:'I really like / I like … very much', note:'Không dùng “very” trực tiếp trước “like”.'},
    {re:/\bi am agree\b/ig, fix:'I agree', note:'“agree” là động từ, không dùng “am”.'},
    {re:/\bpeople is\b/ig, fix:'people are', note:'“people” đi với động từ số nhiều.'},
    {re:/\bhe have\b/ig, fix:'he has', note:'Ngôi thứ ba số ít dùng “has”.'},
    {re:/\bshe have\b/ig, fix:'she has', note:'Ngôi thứ ba số ít dùng “has”.'},
    {re:/\bit help me\b/ig, fix:'it helps me', note:'Ngôi thứ ba số ít cần -s.'},
    {re:/\bit make me\b/ig, fix:'it makes me', note:'Ngôi thứ ba số ít cần -s.'},
    {re:/\bmore easier\b/ig, fix:'easier', note:'Không dùng “more” với comparative “easier”.'},
    {re:/\bcan helps\b/ig, fix:'can help', note:'Sau modal “can” dùng động từ nguyên mẫu.'},
    {re:/\bshould to\b/ig, fix:'should', note:'Sau “should” dùng động từ nguyên mẫu, không có “to”.'},
    {re:/\balthough\b([^.!?]{0,90})\bbut\b/ig, fix:'Although …, … / …, but …', note:'Không dùng “although … but …” trong cùng cấu trúc.'}
  ];

  const linkers = new Set(['because','so','but','also','however','overall','first','firstly','second','secondly','third','thirdly','finally','therefore','although','while']);
  const fillers = new Set(['um','uh','erm']);

  function htmlEscape(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function wordbankTerms(question) {
    return (question?.wordbank || []).map(x => String(x.term || '').toLowerCase()).filter(Boolean);
  }

  function pronunciationTargets(text, question) {
    const terms = wordbankTerms(question).filter(t => text.toLowerCase().includes(t));
    const single = (text.match(/[A-Za-z]{7,}/g) || []).map(x => x.toLowerCase());
    return [...new Set([...terms, ...single])].slice(0, 4);
  }

  function highlightSentence(sentence, question, pronTargets) {
    const topic = wordbankTerms(question);
    const pron = new Set(pronTargets.map(x => x.toLowerCase()));
    const parts = String(sentence).split(/([A-Za-z]+(?:'[A-Za-z]+)?|\s+|[^A-Za-z\s]+)/g).filter(Boolean);
    return parts.map(part => {
      if (!/^[A-Za-z]+(?:'[A-Za-z]+)?$/.test(part)) return htmlEscape(part);
      const low = part.toLowerCase();
      let cls = '';
      if (fillers.has(low)) cls = 'f';
      else if (linkers.has(low)) cls = 'd';
      else if (topic.some(t => t === low || t.split(' ')[0] === low)) cls = 'v';
      else if ([...pron].some(t => t === low)) cls = 'p';
      return cls ? `<span class="tx-mark ${cls}">${htmlEscape(part)}</span>` : htmlEscape(part);
    }).join('');
  }

  function grammarSuggestions(sentence) {
    const out = [];
    for (const rule of grammarRules) {
      rule.re.lastIndex = 0;
      if (rule.re.test(sentence)) {
        out.push(`<span class="tx-fix g"><b>Grammar →</b> ${htmlEscape(rule.note)} <b>Gợi ý:</b> ${htmlEscape(rule.fix)}</span>`);
      }
    }
    return out;
  }

  function discourseSuggestion(sentence, index, total, question) {
    const wc = transcriptWordCount(sentence);
    if (wc < 5) return `<span class="tx-fix d"><b>Discourse →</b> Ý này còn ngắn. Thêm <b>because + reason</b> hoặc <b>for example + detail</b> để phát triển.</span>`;
    if (index > 0 && !/[.!?]\s*(first|second|third|also|because|however|for example|overall|another|in addition)/i.test(`. ${sentence}`) && total >= 4) {
      return `<span class="tx-fix d"><b>Discourse →</b> Có thể thêm từ nối phù hợp để quan hệ giữa các ý rõ hơn.</span>`;
    }
    return '';
  }

  function inlineVocabularySuggestion(sentence, index, missing) {
    if (!missing.length || index !== 1) return '';
    const picks = missing.slice(0, 2).map(x => `<b>${htmlEscape(x.term)}</b> (${htmlEscape(x.vi || '')})`).join(' · ');
    return `<span class="tx-fix v"><b>Vocabulary →</b> Nếu phù hợp với ý của bạn, có thể nâng câu bằng: ${picks}.</span>`;
  }

  function inlineFluencySuggestion(sentence) {
    if (/\b(um|uh|erm)\b/i.test(sentence) || /\byou know\b/i.test(sentence)) {
      return `<span class="tx-fix f"><b>Fluency →</b> Bỏ filler được tô vàng; thay bằng một pause ngắn rồi tiếp tục ý.</span>`;
    }
    return '';
  }

  function renderTranscriptReview() {
    if (!realAudio?.analyzed || !realAudio?.transcript) return;
    const question = typeof current === 'function' ? current() : null;
    const text = normalizedTranscript(realAudio.transcript);
    const sentences = text.match(/[^.!?]+[.!?]?/g)?.map(x => x.trim()).filter(Boolean) || [text];
    const low = text.toLowerCase();
    const missing = (question?.wordbank || []).filter(x => {
      const term = String(x.term || '').toLowerCase();
      return term && !low.includes(term) && !low.includes(term.split(' ')[0]);
    });
    const pronTargets = pronunciationTargets(text, question);
    const source = realAudio.transcriptSource || 'Audio recognition';

    const script = sentences.map((sentence, i) => {
      const fixes = [
        ...grammarSuggestions(sentence),
        inlineVocabularySuggestion(sentence, i, missing),
        inlineFluencySuggestion(sentence),
        discourseSuggestion(sentence, i, sentences.length, question)
      ].filter(Boolean).join('');
      return `<div class="tx-line"><div>${highlightSentence(sentence, question, pronTargets)}</div>${fixes}</div>`;
    }).join('');

    const grammarCount = grammarRules.filter(rule => { rule.re.lastIndex=0; return rule.re.test(text); }).length;
    const m = realAudio.metrics || {};
    review.innerHTML = `
      <div class="tx-head">
        <div><h2>🧠 Transcript & sửa trực tiếp sau khi chấm</h2><p>Transcript chỉ được mở sau khi score đã hoàn tất. Màu sắc bên dưới giúp đối chiếu từng tiêu chí.</p></div>
        <span class="tx-source">${htmlEscape(source)}</span>
      </div>
      <div class="tx-legend">
        <span class="tx-g">Grammar · đỏ</span><span class="tx-v">Vocabulary · tím</span><span class="tx-p">Pronunciation · cam</span><span class="tx-f">Fluency · vàng</span><span class="tx-d">Discourse · xanh</span>
      </div>
      <div class="tx-script">${script}</div>
      <div class="tx-summary">
        <div><b class="tx-g">Grammar</b><p>${grammarCount ? `Phát hiện ${grammarCount} mẫu lỗi cơ bản cần sửa; xem gợi ý đỏ ngay dưới câu.` : 'Không phát hiện mẫu lỗi cơ bản trong nhóm hệ thống đang theo dõi.'}</p></div>
        <div><b class="tx-v">Vocabulary</b><p>${missing.length ? `Có thể cân nhắc thêm: ${missing.slice(0,3).map(x=>htmlEscape(x.term)).join(', ')}.` : 'Bạn đã sử dụng khá đầy đủ nhóm từ khóa gợi ý của câu hỏi.'}</p></div>
        <div><b class="tx-p">Pronunciation</b><p>${pronTargets.length ? `Các từ cam là mục tiêu nên nghe lại/luyện stress & ending: ${pronTargets.map(htmlEscape).join(', ')}. Đây là mục tiêu luyện, không khẳng định từng từ đã phát âm sai.` : 'Không có từ dài nổi bật để gắn mục tiêu luyện phát âm trong transcript này.'}</p></div>
        <div><b class="tx-f">Fluency</b><p>${Number.isFinite(m.pauseRatio) ? `Pause ratio khoảng ${Math.round(m.pauseRatio*100)}%; long pauses: ${m.longPauseCount || 0}. Filler được tô vàng.` : 'Fluency dựa trên waveform của bản ghi và filler trong transcript.'}</p></div>
        <div style="grid-column:1/-1"><b class="tx-d">Discourse Management</b><p>Các từ nối được tô xanh. Gợi ý phát triển ý được đặt ngay dưới câu còn ngắn hoặc thiếu liên kết.</p></div>
      </div>`;

    review.classList.add('show');
    if (window.innerWidth < 760) setTimeout(() => review.scrollIntoView({behavior:'smooth', block:'start'}), 280);
  }

  // Wrap score so scores/feedback render first, transcript review second.
  const baseScoreResponse = scoreResponse;
  scoreResponse = function(...args) {
    resetReview();
    const out = baseScoreResponse.apply(this, args);
    if (realAudio?.analyzed && realAudio?.transcript) setTimeout(renderTranscriptReview, 320);
    return out;
  };

  // Flow copy now reflects the requested order students see.
  const flowSteps = document.querySelectorAll('#autoFlow .flow-step');
  if (flowSteps[1]) flowSteps[1].innerHTML = '<span>2</span><div><b>AI Analyse</b><small>Phân tích audio ẩn</small></div>';
  if (flowSteps[2]) flowSteps[2].innerHTML = '<span>3</span><div><b>Score</b><small>Hiện điểm 5 tiêu chí</small></div>';
  if (flowSteps[3]) flowSteps[3].innerHTML = '<span>4</span><div><b>Transcript</b><small>Mở script + sửa lỗi</small></div>';

  const note = q('#micNote');
  if (note) note.innerHTML = '<b>Flow mới:</b> Mic → STOP → AI phân tích ẩn → <b>hiện điểm trước</b> → sau đó mới mở <b>Transcript có code màu + sửa trực tiếp</b>.';

  window.__vstepTranscriptDiagnostics = () => ({
    recognitionSupported: !!Recognition,
    liveWords: transcriptWordCount(liveTranscript()),
    analyzed: !!realAudio?.analyzed,
    transcriptWords: transcriptWordCount(realAudio?.transcript || ''),
    transcriptSource: realAudio?.transcriptSource || '',
    reviewVisible: review.classList.contains('show')
  });
})();
