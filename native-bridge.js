/*
 * native-bridge.js
 * 휴대폰 앱(Capacitor)으로 실행될 때만 동작합니다. 웹/PWA에서는 아무것도 하지 않습니다.
 * 안드로이드·iOS 앱 안의 WebView는 브라우저 음성 기능(speechSynthesis, SpeechRecognition)을
 * 제대로 지원하지 않으므로, 같은 이름의 객체를 네이티브 플러그인으로 대신 만들어 줍니다.
 * 덕분에 index.html의 앱 코드는 웹과 앱에서 그대로 공유됩니다.
 *   - 읽어 주기: @capacitor-community/text-to-speech
 *   - 발음 인식: @capacitor-community/speech-recognition
 */
(function () {
  "use strict";
  var Cap = window.Capacitor;
  if (!Cap || !Cap.isNativePlatform || !Cap.isNativePlatform()) return;
  var P = Cap.Plugins || {};
  window.__OPIC_NATIVE__ = true;

  /* ---------- 1. 읽어 주기 (TTS) ---------- */
  var TTS = P.TextToSpeech;
  if (TTS) {
    var current = null;
    function Utter(text) { this.text = text || ""; this.lang = "en-US"; this.rate = 1; this.pitch = 1; this.volume = 1; this.voice = null;
      this.onstart = this.onend = this.onerror = this.onboundary = null; }
    var synth = {
      speaking: false, pending: false, paused: false, onvoiceschanged: null,
      getVoices: function () { return []; },
      speak: function (u) {
        current = u; synth.speaking = true;
        setTimeout(function () { if (current === u && u.onstart) u.onstart({}); }, 0);
        TTS.speak({ text: u.text, lang: u.lang || "en-US", rate: u.rate || 1, pitch: u.pitch || 1, volume: u.volume == null ? 1 : u.volume, category: "playback" })
          .then(function () { if (current === u) { current = null; synth.speaking = false; } if (u.onend) u.onend({}); })
          .catch(function () { if (current === u) { current = null; synth.speaking = false; } if (u.onerror) u.onerror({ error: "interrupted" }); });
      },
      cancel: function () { current = null; synth.speaking = false; try { TTS.stop(); } catch (e) {} },
      pause: function () {}, resume: function () {}
    };
    // 플러그인이 단어 위치 이벤트를 보내 주면 하이라이트를 정확히 맞춥니다. (없으면 앱이 예상 속도로 따라갑니다)
    try {
      if (TTS.addListener) TTS.addListener("onRangeStart", function (e) {
        if (current && current.onboundary && e && typeof e.start === "number") current.onboundary({ name: "word", charIndex: e.start });
      });
    } catch (e) {}
    try { Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true, writable: true }); } catch (e) { window.speechSynthesis = synth; }
    window.SpeechSynthesisUtterance = Utter;
  }

  /* ---------- 2. 녹음과 인식이 마이크를 다투지 않게 ---------- */
  // 휴대폰에서는 음성 인식이 마이크를 독점해야 안정적입니다.
  // 그래서 앱 모드에서는 '내 녹음 듣기'용 녹음을 끄고 발음 인식만 사용합니다.
  var SRP = P.SpeechRecognition;
  if (SRP) {
    try { window.MediaRecorder = undefined; } catch (e) {}
    var md = navigator.mediaDevices || (navigator.mediaDevices = {});
    md.getUserMedia = function () {
      return SRP.requestPermissions().then(function (r) {
        var st = r && (r.speechRecognition || r.microphone);
        if (st && st !== "granted") { var err = new Error("NotAllowedError"); err.name = "NotAllowedError"; throw err; }
        var AC = window.AudioContext || window.webkitAudioContext;
        var ctx = new AC(); var dst = ctx.createMediaStreamDestination();
        var stream = dst.stream, stop0 = stream.getTracks().map(function (t) { return t.stop.bind(t); });
        stream.getTracks().forEach(function (t, k) { t.stop = function () { stop0[k](); try { ctx.close(); } catch (e) {} }; });
        return stream;
      });
    };

    /* ---------- 3. 발음 인식 (SpeechRecognition 대체) ---------- */
    var active = null;
    function evt(matches, isFinal) {
      var r = (matches || []).map(function (t) { return { transcript: t, confidence: 0.9 }; });
      r.isFinal = isFinal;
      return { resultIndex: 0, results: [r] };
    }
    function finish(rec) {
      if (rec._ended) return; rec._ended = true;
      if (active === rec) active = null;
      if (!rec._aborted && rec._last && rec._last.length && rec.onresult) rec.onresult(evt(rec._last, true));
      if (rec.onend) rec.onend({});
    }
    SRP.addListener("partialResults", function (d) {
      var rec = active; if (!rec || rec._ended) return;
      var m = (d && d.matches) || (d && d.value) || [];
      if (!m.length) return;
      rec._last = m;
      if (rec.interimResults && rec.onresult) rec.onresult(evt(m.slice(0, 1), false));
    });
    SRP.addListener("listeningState", function (d) {
      var rec = active; if (!rec) return;
      if (d && d.status === "stopped") setTimeout(function () { finish(rec); }, 250);
    });

    function Rec() { this.lang = "en-US"; this.interimResults = false; this.maxAlternatives = 1; this.continuous = false;
      this.onresult = this.onerror = this.onend = this.onstart = null; this._last = null; this._ended = false; this._aborted = false; }
    Rec.prototype.start = function () {
      var rec = this;
      if (active && active !== rec) { try { active.abort(); } catch (e) {} }
      active = rec;
      SRP.requestPermissions().then(function (r) {
        var st = r && (r.speechRecognition || r.microphone);
        if (st && st !== "granted") throw { perm: true };
        return SRP.start({ language: rec.lang || "en-US", maxResults: Math.max(1, rec.maxAlternatives || 1), partialResults: true, popup: false });
      }).then(function (res) {
        // 일부 버전은 partialResults여도 끝날 때 결과를 돌려줍니다.
        if (res && res.matches && res.matches.length) { rec._last = res.matches; setTimeout(function () { finish(rec); }, 0); }
        if (rec.onstart) rec.onstart({});
      }).catch(function (e) {
        if (rec._ended) return;
        if (rec.onerror) rec.onerror({ error: e && e.perm ? "not-allowed" : "no-speech" });
        finish(rec);
      });
    };
    Rec.prototype.stop = function () {
      var rec = this; try { SRP.stop(); } catch (e) {}
      setTimeout(function () { finish(rec); }, 700); // listeningState가 오지 않는 기기 대비
    };
    Rec.prototype.abort = function () { this._aborted = true; try { SRP.stop(); } catch (e) {} finish(this); };
    window.SpeechRecognition = Rec;
    window.webkitSpeechRecognition = Rec;
  }
})();
