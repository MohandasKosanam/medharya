# Medharya QLoRA setup

This directory contains the reproducible local training environment and the
guarded smoke-test entry point. It does not contain application runtime code.
The original model and all future training outputs are kept outside the
application source tree:

```text
.venv-qlora/                                  local Python environment
models/Qwen3-4B-Thinking-2507-hf/             original HF checkpoint
training/data/                                 approved datasets only
training/checkpoints/                          resumable trainer checkpoints
training/adapters/                             LoRA/QLoRA adapter outputs
training/outputs/                              reports and generated artifacts
training/logs/                                 training logs
```

## Base checkpoint

- Repository: `Qwen/Qwen3-4B-Thinking-2507`
- Pinned revision: `768f209d9ea81521153ed38c47d515654e938aea`
- License: Apache License 2.0
- Expected repository payload: `8,060,920,921` bytes before local cache metadata
- Model shards: three `safetensors` files totaling `8,044,982,000` bytes
- Verified file sizes and shard hashes: `training/model-manifest.json`

The installed Ollama `qwen3:4b` model is preserved separately and is not used
as a training input. It is the quantized `Q4_K_M` inference artifact.

## Environment

The environment is pinned to Python `3.13.14` in the repository-level
`.python-version` file. It uses the official PyTorch CUDA 12.8 wheel for
Windows x86-64; no system Python packages are required.

Create or reuse the environment:

```powershell
python -m venv .venv-qlora
.\.venv-qlora\Scripts\python.exe -m pip install `
  --index-url https://download.pytorch.org/whl/cu128 `
  --extra-index-url https://pypi.org/simple `
  --requirement training/requirements-qlora.txt
```

The direct pins are in `training/requirements-qlora.txt`. The complete
environment freeze is in `training/requirements-qlora.lock.txt`.

Verify the environment without loading model weights:

```powershell
.\.venv-qlora\Scripts\python.exe -m pip check
.\.venv-qlora\Scripts\python.exe training/qlora_smoke_test.py
```

The second command only reports that the guarded smoke test is prepared. It
does not load the model or perform a training step. The GPU test requires an
explicit `--run` argument and must be approved separately.

## Current boundary

No dataset has been approved or placed in `training/data/`. No training run,
adapter creation, checkpoint creation, or application integration is started
by this setup.
