#!/usr/bin/env bash
# Fetch the local models Recap needs (kept out of git — they're large and re-downloadable).
#   - Whisper base.en (ONNX) for on-device transcription  -> src/renderer/public/models
#   - pyannote segmentation + 3D-Speaker embedding         -> models/diarization
set -euo pipefail
cd "$(dirname "$0")/.."

WHISPER_DIR="src/renderer/public/models/Xenova/whisper-base.en"
HF="https://huggingface.co/Xenova/whisper-base.en/resolve/main"

echo "→ Whisper base.en (transcription)…"
mkdir -p "$WHISPER_DIR/onnx"
for f in config.json tokenizer.json tokenizer_config.json generation_config.json preprocessor_config.json; do
  [ -f "$WHISPER_DIR/$f" ] || curl -SL --fail -o "$WHISPER_DIR/$f" "$HF/$f"
done
for f in encoder_model.onnx decoder_model_merged.onnx; do
  [ -f "$WHISPER_DIR/onnx/$f" ] || curl -SL --fail -o "$WHISPER_DIR/onnx/$f" "$HF/onnx/$f"
done

echo "→ Speaker diarization models…"
mkdir -p models/diarization
cd models/diarization
SEG="https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2"
EMB="https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common.onnx"
[ -d sherpa-onnx-pyannote-segmentation-3-0 ] || { curl -SL --fail -O "$SEG" && tar xf sherpa-onnx-pyannote-segmentation-3-0.tar.bz2; }
[ -f "$(basename "$EMB")" ] || curl -SL --fail -O "$EMB"

echo "✓ Models ready."
