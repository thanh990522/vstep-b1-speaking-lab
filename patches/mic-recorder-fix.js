(() => {
  'use strict';

  const btn = document.querySelector('#micBtn');
  if (!btn || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return;

  let selectedMime = '';
  let decodeContext = null;
  let downloadLink = null;
  let localSaveStatus = null;
  let recorderError = null;
  let bytesReceived = 0;

  function pickMimeType() {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4;codecs=mp4a.40.2',
      'audio/mp4',
      'audio/ogg;codecs=opus',
      'audio/ogg'
    ];
    if (typeof MediaRecorder.isTypeSupported !== 'function') return '';
    return candidates.find(type => {
      try { return MediaRecorder.isTypeSupported(type); } catch { return false; }
    }) || '';
  }

  function extensionFor(type='') {
    const t = String(type).toLowerCase();
    if (t.includes('mp4') || t.includes('m4a')) return 'm4a';
    if (t.includes('ogg')) return 'ogg';
    if (t.includes('wav')) return 'wav';
    return 'webm';
  }

  function cleanupStream() {
    try { mediaStream?.getTracks?.().forEach(track => track.stop()); } catch {}
    mediaStream = null;
  }

  function ensureSaveUI() {
    const wrap = document.querySelector('#audioPreviewWrap');
    if (!wrap) return;
    if (!document.querySelector('#recordingSaveRow')) {
      const row = document.createElement('div');
      row.id = 'recordingSaveRow';
      row.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:9px';
      row.innerHTML = `
        <a id="downloadRecording" href="#" download style="display:none;text-decoration:none;padding:8px 11px;border-radius:10px;background:#eef2ff;color:#4f46e5;font-size:11px;font-weight:900;border:1px solid #c7d2fe">⬇️ Lưu bản ghi</a>
        <span id="localRecordingStatus" style="font-size:10.5px;color:#667085"></span>`;
      wrap.appendChild(row);
    }
    downloadLink = document.querySelector('#downloadRecording');
    localSaveStatus = document.querySelector('#localRecordingStatus');
  }

  function openRecordingDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
      const req = indexedDB.open('vstep-speaking-recordings', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('recordings')) db.createObjectStore('recordings');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    });
  }

  async function persistRecording(blob, name, mime) {
    try {
      const db = await openRecordingDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('recordings', 'readwrite');
        tx.objectStore('recordings').put({blob, name, mime, size: blob.size, savedAt: Date.now()}, activeAudioQuestionKey());
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted'));
      });
      db.close();
      if (localSaveStatus) localSaveStatus.textContent = '✓ Bản ghi đã được lưu tạm trên thiết bị';
      return true;
    } catch (err) {
      console.warn('Local recording persistence unavailable:', err);
      if (localSaveStatus) localSaveStatus.textContent = 'Bản ghi vẫn có thể phát và tải xuống trong phiên này';
      return false;
    }
  }

  async function adoptRecordedBlob(blob, name, mime) {
    resetRealAudio();
    ensureSaveUI();

    if (!blob || blob.size < 512) {
      throw new Error(`Bản ghi quá nhỏ (${blob?.size || 0} bytes). Trình duyệt chưa xuất dữ liệu microphone.`);
    }

    realAudio.blob = blob;
    realAudio.name = name;
    realAudio.questionKey = activeAudioQuestionKey();
    realAudio.url = URL.createObjectURL(blob);

    const preview = document.querySelector('#audioPreview');
    preview.setAttribute('playsinline', '');
    preview.preload = 'metadata';
    preview.src = realAudio.url;
    preview.load();

    document.querySelector('#audioPreviewWrap').style.display = 'block';
    document.querySelector('#audioFileMeta').textContent = `${name} · ${(blob.size/1024).toFixed(1)} KB · ${mime || blob.type || 'audio'}`;
    document.querySelector('#recordLed').className = 'record-led';
    document.querySelector('#recordLed').innerHTML = '<i style="background:#10b981"></i><span>Audio đã sẵn sàng</span>';

    downloadLink.href = realAudio.url;
    downloadLink.download = name;
    downloadLink.style.display = 'inline-block';
    localSaveStatus.textContent = 'Đang lưu bản ghi…';

    const arr = await blob.arrayBuffer();
    if (!decodeContext) decodeContext = new (window.AudioContext || window.webkitAudioContext)();
    try { if (decodeContext.state === 'suspended') await decodeContext.resume(); } catch {}
    const buffer = await decodeContext.decodeAudioData(arr.slice(0));
    realAudio.buffer = buffer;
    realAudio.mono = mixToMono(buffer);
    realAudio.audio16k = resampleLinear(realAudio.mono, buffer.sampleRate, 16000);
    realAudio.metrics = analyzeWave(realAudio.mono, buffer.sampleRate);
    drawWave(realAudio.mono, realAudio.metrics);
    updateAudioEvidence(realAudio.metrics);
    document.querySelector('#audioFileMeta').textContent += ` · ${realAudio.metrics.totalDuration.toFixed(1)}s`;

    await persistRecording(blob, name, mime || blob.type);
  }

  async function processStoppedRecording(recorder) {
    await new Promise(resolve => setTimeout(resolve, 80));
    cleanupStream();

    if (recorderError) throw recorderError;
    const actualMime = recorder?.mimeType || selectedMime || recordedChunks.find(x => x?.type)?.type || 'audio/webm';
    const blob = new Blob(recordedChunks, {type: actualMime});
    const name = `vstep-speaking-${Date.now()}.${extensionFor(actualMime)}`;

    setFlowStage('transcribe');
    setAutoStatus('💾', 'Đã ghi âm', `Đã nhận ${(blob.size/1024).toFixed(1)} KB audio. Đang chuẩn bị file…`, true);
    await adoptRecordedBlob(blob, name, actualMime);

    setFlowStage('transcribe');
    setAutoStatus('🧠', 'AI đang nghe', 'Đang tạo transcript từ chính bản ghi vừa lưu…', true);
    await analyzeRealAudio();
    if (!realAudio.analyzed) throw new Error('AI chưa tạo được transcript từ bản ghi. File audio đã được giữ lại để bạn có thể phát hoặc tải xuống.');

    setFlowStage('score');
    setAutoStatus('📊', 'Đang chấm điểm', 'Đang phân tích 5 tiêu chí VSTEP B1…', true);
    await new Promise(r => setTimeout(r, 180));
    scoreResponse();

    setFlowStage('feedback');
    setAutoStatus('✅', 'Đã chấm xong', 'Bản ghi đã được lưu; feedback và model answer đã sẵn sàng.', false);
    setTimeout(() => setFlowStage('done'), 450);

    btn.classList.remove('processing', 'recording');
    btn.disabled = false;
    document.querySelector('#micMainLabel').textContent = 'Nói lại để cải thiện điểm';
    document.querySelector('#micSubLabel').textContent = 'Bản ghi vừa rồi vẫn ở bên dưới để nghe lại hoặc tải xuống';
  }

  async function startRobustRecording() {
    resetAttempt();
    resetRealAudio();
    ensureSaveUI();
    if (downloadLink) downloadLink.style.display = 'none';
    if (localSaveStatus) localSaveStatus.textContent = '';

    recorderError = null;
    bytesReceived = 0;
    recordedChunks = [];
    selectedMime = pickMimeType();

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      }
    });

    const tracks = mediaStream.getAudioTracks();
    if (!tracks.length) throw new Error('Không tìm thấy audio track từ microphone.');

    try {
      if (!decodeContext || decodeContext.state === 'closed') decodeContext = new (window.AudioContext || window.webkitAudioContext)();
      if (decodeContext.state === 'suspended') await decodeContext.resume();
    } catch (err) { console.warn('AudioContext prewarm failed:', err); }

    const options = selectedMime ? {mimeType: selectedMime, audioBitsPerSecond: 128000} : {audioBitsPerSecond: 128000};
    try {
      mediaRecorder = new MediaRecorder(mediaStream, options);
    } catch (err) {
      console.warn('MediaRecorder options rejected, retrying defaults:', err);
      mediaRecorder = new MediaRecorder(mediaStream);
      selectedMime = mediaRecorder.mimeType || '';
    }

    mediaRecorder.ondataavailable = event => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
        bytesReceived += event.data.size;
        const status = document.querySelector('#aiStatus');
        if (status && mediaRecorder?.state === 'recording') status.textContent = `Đang ghi âm… đã nhận ${(bytesReceived/1024).toFixed(1)} KB`;
      }
    };
    mediaRecorder.onerror = event => {
      recorderError = event.error || new Error('MediaRecorder error');
      console.error('MediaRecorder error:', recorderError);
    };
    mediaRecorder.onstop = async () => {
      try {
        await processStoppedRecording(mediaRecorder);
      } catch (err) {
        console.error(err);
        cleanupStream();
        btn.classList.remove('processing', 'recording');
        btn.disabled = false;
        document.querySelector('#micMainLabel').textContent = 'Thử ghi âm lại';
        document.querySelector('#micSubLabel').textContent = 'Nếu audio đã xuất hiện bên dưới, bạn vẫn có thể nghe hoặc tải file';
        setFlowStage('record');
        setAutoStatus('⚠️', 'Ghi âm/chấm điểm chưa hoàn tất', err.message || String(err), false);
      }
    };

    mediaRecorder.start(1000);
    attemptStartedAt = Date.now();
    btn.classList.add('recording');
    btn.classList.remove('processing');
    document.querySelector('#micMainLabel').textContent = 'STOP — Hoàn tất bài nói';
    document.querySelector('#micSubLabel').textContent = `Đang ghi ${mediaRecorder.mimeType || selectedMime || 'audio'} · bấm STOP khi nói xong`;
    setFlowStage('record');
    setAutoStatus('🔴', 'Đang ghi âm', 'Microphone đang thu và lưu dữ liệu theo từng giây…', false);
  }

  async function stopRobustRecording() {
    if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
    btn.disabled = true;
    btn.classList.remove('recording');
    btn.classList.add('processing');
    document.querySelector('#micMainLabel').textContent = 'Đang lưu bản ghi…';
    document.querySelector('#micSubLabel').textContent = 'Đợi trình duyệt đóng file audio trước khi AI xử lý';
    setFlowStage('transcribe');
    setAutoStatus('💾', 'Đang lưu file', `Đã thu ${(bytesReceived/1024).toFixed(1)} KB, đang chốt bản ghi…`, true);
    attemptEndedAt = Date.now();
    try { mediaRecorder.stop(); }
    catch (err) {
      cleanupStream();
      btn.disabled = false;
      btn.classList.remove('processing');
      throw err;
    }
  }

  btn.onclick = async () => {
    try {
      if (mediaRecorder && mediaRecorder.state === 'recording') await stopRobustRecording();
      else if (!mediaRecorder || mediaRecorder.state === 'inactive') await startRobustRecording();
    } catch (err) {
      console.error(err);
      cleanupStream();
      btn.disabled = false;
      btn.classList.remove('processing', 'recording');
      document.querySelector('#micMainLabel').textContent = 'Thử ghi âm lại';
      document.querySelector('#micSubLabel').textContent = 'Kiểm tra quyền Microphone của trình duyệt';
      setFlowStage('record');
      setAutoStatus('⚠️', 'Không thể ghi âm', err.message || String(err), false);
    }
  };

  ensureSaveUI();
  window.__vstepRecorderDiagnostics = () => ({
    supported: !!window.MediaRecorder,
    selectedMime,
    recorderMime: mediaRecorder?.mimeType || '',
    recorderState: mediaRecorder?.state || 'none',
    chunks: recordedChunks?.length || 0,
    bytesReceived,
    blobSize: realAudio?.blob?.size || 0,
    hasDecodedAudio: !!realAudio?.audio16k,
    hasPreviewUrl: !!realAudio?.url
  });
})();