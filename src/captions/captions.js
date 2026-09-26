'use strict';

const LINE_LIMIT = 2;
const LINE_SECONDS = 7;
const LEVEL_INTERVAL_MS = 200;
const SAMPLE_RATE = 16000;

const container = document.getElementById('captions');
const { createSpeechGate, gateThreshold, levelFromRms } = window.captionSpeechGate;

let state = { fontSize: 30, background: 'dark', showOriginal: false, deviceId: '', gate: 40 };
let audio = null;
let activeDeviceId = null;
let startGeneration = 0;
let interimElement = null;
let lastLevelAt = 0;
let peakLevel = 0;

const gate = createSpeechGate({
  send: chunk => window.captions.sendAudio(chunk),
  speechEnded: () => window.captions.speechEnded()
});

function microphoneErrorText(error) {
  if (error?.name === 'NotAllowedError') {
    return 'Kein Zugriff auf das Mikrofon. In Windows unter Einstellungen → Datenschutz → Mikrofon den Zugriff für Desktop-Apps erlauben.';
  }
  if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') return 'Es wurde kein Mikrofon gefunden.';
  if (error?.name === 'NotReadableError') return 'Das Mikrofon wird gerade exklusiv von einem anderen Programm verwendet.';
  return `Mikrofon konnte nicht gestartet werden: ${error?.message || error}`;
}

function audioConstraints(deviceId) {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: true,
    autoGainControl: false
  };
}

function stopAudio() {
  gate.reset();
  if (!audio) return;
  for (const track of audio.stream.getTracks()) track.stop();
  audio.context.close().catch(() => {});
  audio = null;
}

async function reportDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    window.captions.reportDevices(devices
      // "default" and "communications" are Windows aliases; an empty ID already means default.
      .filter(device => device.kind === 'audioinput' && !['default', 'communications'].includes(device.deviceId))
      .map(device => ({ deviceId: device.deviceId, label: device.label || 'Mikrofon' })));
  } catch {}
}

async function startAudio() {
  const generation = ++startGeneration;
  const deviceId = state.deviceId || '';
  activeDeviceId = deviceId;
  stopAudio();
  let stream = null;
  let context = null;
  try {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(deviceId), video: false });
    } catch (error) {
      if (!deviceId) throw error;
      // The saved microphone was unplugged or renamed; fall back to the default device.
      stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(''), video: false });
    }
    // Chromium resamples the microphone to the 16 kHz that Deepgram expects.
    context = new AudioContext({ sampleRate: SAMPLE_RATE });
    await context.audioWorklet.addModule('audio-worklet.js');
    if (generation !== startGeneration) throw new Error('superseded');
    const source = context.createMediaStreamSource(stream);
    const capture = new AudioWorkletNode(context, 'caption-capture', { processorOptions: { frameSize: SAMPLE_RATE / 10 } });
    // A muted path to the output keeps the graph running without playing the microphone back.
    const mute = context.createGain();
    mute.gain.value = 0;
    capture.port.onmessage = ({ data }) => handleFrame(data);
    source.connect(capture);
    capture.connect(mute);
    mute.connect(context.destination);
    audio = { stream, context };
    window.captions.reportAudioError(null);
    reportDevices();
  } catch (error) {
    stream?.getTracks().forEach(track => track.stop());
    context?.close().catch(() => {});
    if (generation !== startGeneration) return;
    window.captions.reportAudioError(microphoneErrorText(error));
  }
}

function handleFrame({ pcm, rms }) {
  gate.push(pcm, rms, gateThreshold(state.gate));
  peakLevel = Math.max(peakLevel, levelFromRms(rms));
  const now = Date.now();
  if (now - lastLevelAt >= LEVEL_INTERVAL_MS) {
    window.captions.reportLevel({ level: Math.round(peakLevel), speaking: gate.speaking });
    lastLevelAt = now;
    peakLevel = 0;
  }
}

function applyState(next) {
  state = { ...state, ...(next || {}) };
  document.documentElement.style.setProperty('--caption-size', `${Number(state.fontSize) || 30}px`);
  document.body.className = state.background === 'green' ? 'background-green' : 'background-dark';
  for (const original of container.querySelectorAll('.caption-original')) {
    original.classList.toggle('hidden', !state.showOriginal);
  }
  if (activeDeviceId !== (state.deviceId || '')) startAudio();
}

function clearInterim() {
  interimElement?.remove();
  interimElement = null;
}

function showInterim({ text } = {}) {
  if (!text) {
    clearInterim();
    return;
  }
  if (!interimElement) {
    interimElement = document.createElement('div');
    interimElement.className = 'caption-line interim';
    container.append(interimElement);
  }
  interimElement.textContent = text;
}

function showLine(line) {
  clearInterim();
  if (!line?.text) return;
  const element = document.createElement('div');
  element.className = 'caption-line';
  if (line.translated && line.original) {
    const original = document.createElement('span');
    original.className = 'caption-original';
    original.classList.toggle('hidden', !state.showOriginal);
    original.textContent = line.original;
    element.append(original);
  }
  element.append(document.createTextNode(line.text));
  container.append(element);
  const finals = [...container.querySelectorAll('.caption-line:not(.interim)')];
  for (const old of finals.slice(0, Math.max(0, finals.length - LINE_LIMIT))) old.remove();
  window.setTimeout(() => {
    element.classList.add('fading');
    window.setTimeout(() => element.remove(), 500);
  }, LINE_SECONDS * 1000);
}

navigator.mediaDevices.addEventListener('devicechange', reportDevices);
window.captions.onState(applyState);
window.captions.onInterim(showInterim);
window.captions.onLine(showLine);
window.captions.getState().then(applyState).catch(error => window.captions.reportAudioError(error.message));
