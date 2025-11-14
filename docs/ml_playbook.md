# ML Playbook — hof-smart (docs/ml_playbook.md)


This playbook explains in plain language how the ML pieces work, how to run training, evaluate, promote models, and rollback.


## How to run training
1. Activate your Python virtualenv and ensure dependencies are installed.
2. From the repo root run the training script (example):
```bash
cd backend/ml
python train.py --config configs/train_duration.yaml