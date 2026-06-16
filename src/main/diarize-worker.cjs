'use strict';

const path = require('path');
const fs = require('fs');

function fail(msg) {
  process.stdout.write(JSON.stringify({ error: String(msg) }) + '\n');
  process.exit(1);
}

try {
  const wavPath = process.argv[2];
  const numClustersArg = process.argv[3];

  if (!wavPath) fail('usage: node diarize-worker.cjs <wavPath> [numClusters|-1]');
  if (!fs.existsSync(wavPath)) fail(`wav not found: ${wavPath}`);

  const numClusters = numClustersArg === undefined ? -1 : parseInt(numClustersArg, 10);
  if (Number.isNaN(numClusters)) fail(`invalid numClusters: ${numClustersArg}`);

  const modelsDir = path.resolve(__dirname, '..', '..', 'models', 'diarization');
  const segModel = path.join(modelsDir, 'sherpa-onnx-pyannote-segmentation-3-0', 'model.onnx');
  const embModel = path.join(modelsDir, '3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common.onnx');

  if (!fs.existsSync(segModel)) fail(`segmentation model missing: ${segModel}`);
  if (!fs.existsSync(embModel)) fail(`embedding model missing: ${embModel}`);

  const sherpa_onnx = require('sherpa-onnx-node');

  const config = {
    segmentation: { pyannote: { model: segModel } },
    embedding: { model: embModel },
    clustering: {
      numClusters: numClusters > 0 ? numClusters : -1,
      threshold: 0.5,
    },
    minDurationOn: 0.2,
    minDurationOff: 0.5,
  };

  const sd = new sherpa_onnx.OfflineSpeakerDiarization(config);

  const wave = sherpa_onnx.readWave(wavPath);
  if (sd.sampleRate !== wave.sampleRate) {
    fail(`expected sample rate ${sd.sampleRate}, got ${wave.sampleRate} (resample to ${sd.sampleRate} mono)`);
  }

  const segments = sd.process(wave.samples);

  const out = segments.map((s) => ({
    start: Number(s.start),
    end: Number(s.end),
    speaker: Number(s.speaker),
  }));

  process.stdout.write(JSON.stringify(out) + '\n');
  process.exit(0);
} catch (err) {
  fail(err && err.stack ? err.stack : err);
}
