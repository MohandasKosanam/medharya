"""Prepare or explicitly run one conservative QLoRA compatibility step.

The default invocation is intentionally side-effect free: it checks imports
and prints the command boundary without loading the 4B checkpoint. Passing
--run is required before model weights are loaded, gradients are computed, or
an adapter is written. This file is prepared during setup; the GPU path is not
run automatically.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


MODEL_DIR = Path("models/Qwen3-4B-Thinking-2507-hf")
DEFAULT_OUTPUT_DIR = Path("training/adapters/smoke-test")
MAX_LENGTH = 128


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, default=MODEL_DIR)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument(
        "--run",
        action="store_true",
        help="Load the 4-bit model and perform exactly one tiny adapter update.",
    )
    return parser.parse_args()


def import_check() -> None:
    import accelerate
    import bitsandbytes
    import datasets
    import peft
    import safetensors
    import torch
    import transformers
    import trl

    print("python_qlora_imports=ok")
    print(f"torch={torch.__version__}")
    print(f"torch_cuda_build={torch.version.cuda}")
    print(f"transformers={transformers.__version__}")
    print(f"peft={peft.__version__}")
    print(f"trl={trl.__version__}")
    print(f"datasets={datasets.__version__}")
    print(f"accelerate={accelerate.__version__}")
    print(f"bitsandbytes={bitsandbytes.__version__}")
    print(f"safetensors={safetensors.__version__}")
    print(f"cuda_available={torch.cuda.is_available()}")
    if torch.cuda.is_available():
        free, total = torch.cuda.mem_get_info()
        print(f"gpu={torch.cuda.get_device_name(0)}")
        print(f"gpu_capability={torch.cuda.get_device_capability(0)}")
        print(f"gpu_free_gib={free / 1024**3:.2f}")
        print(f"gpu_total_gib={total / 1024**3:.2f}")


def run_smoke(model_dir: Path, output_dir: Path) -> None:
    import torch
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    if not torch.cuda.is_available():
        raise RuntimeError("The QLoRA smoke test requires a CUDA-capable PyTorch build.")
    if not model_dir.is_dir():
        raise FileNotFoundError(f"Model directory does not exist: {model_dir}")

    tokenizer = AutoTokenizer.from_pretrained(model_dir, local_files_only=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    quantization_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.float16,
        bnb_4bit_use_double_quant=True,
    )
    model = AutoModelForCausalLM.from_pretrained(
        model_dir,
        local_files_only=True,
        device_map="auto",
        torch_dtype=torch.float16,
        low_cpu_mem_usage=True,
        quantization_config=quantization_config,
    )
    model.config.use_cache = False
    model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
    model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    model = get_peft_model(
        model,
        LoraConfig(
            r=4,
            lora_alpha=8,
            lora_dropout=0.05,
            bias="none",
            task_type="CAUSAL_LM",
            target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        ),
    )
    model.print_trainable_parameters()

    examples = [
        [
            {"role": "user", "content": "Give one concise planning step for a small web project."},
            {"role": "assistant", "content": "Clarify the smallest user-visible workflow before choosing tools."},
        ],
        [
            {"role": "user", "content": "What should a project brief record first?"},
            {"role": "assistant", "content": "Record the goal, intended users, constraints, and success criteria."},
        ],
    ]
    texts = [
        tokenizer.apply_chat_template(example, tokenize=False, add_generation_prompt=False)
        for example in examples
    ]
    batch = tokenizer(texts, return_tensors="pt", padding=True, truncation=True, max_length=MAX_LENGTH)
    batch["labels"] = batch["input_ids"].clone()
    batch["labels"][batch["attention_mask"] == 0] = -100
    device = next(model.parameters()).device
    batch = {key: value.to(device) for key, value in batch.items()}

    optimizer = torch.optim.AdamW(
        [parameter for parameter in model.parameters() if parameter.requires_grad],
        lr=1e-4,
    )
    model.train()
    loss = model(**batch).loss
    loss.backward()
    optimizer.step()
    optimizer.zero_grad(set_to_none=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(output_dir)
    tokenizer.save_pretrained(output_dir)
    (output_dir / "smoke-metadata.json").write_text(
        json.dumps(
            {
                "max_length": MAX_LENGTH,
                "batch_size": 2,
                "gradient_checkpointing": True,
                "loss": float(loss.detach().cpu()),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"smoke_loss={float(loss.detach().cpu()):.6f}")
    print(f"adapter_output={output_dir}")


def main() -> None:
    args = parse_args()
    import_check()
    if not args.run:
        print("QLoRA GPU smoke test is prepared but not run; pass --run only after approval.")
        return
    run_smoke(args.model_dir, args.output_dir)


if __name__ == "__main__":
    main()
