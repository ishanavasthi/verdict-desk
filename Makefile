SHELL := /bin/bash
.DEFAULT_GOAL := help

# NOTE: do NOT `include .env` here. make parses it with Makefile syntax and does
# NOT strip quotes, so `DATABASE_URL="postgres://..."` would be exported WITH the
# literal quotes — and dotenv-cli won't override an already-set var, so Prisma then
# rejects the value ("must start with postgresql://"). Recipes load .env themselves:
# every pnpm script uses `dotenv -e ../../.env`, and docker compose reads .env directly.

.PHONY: help setup db-up db-down migrate seed dev down reset prisma-generate test lint

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | sort | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

setup: ## Install deps, create .env, pre-pull the sandbox image
	@[ -f .env ] || (cp .env.example .env && echo "created .env from .env.example")
	pnpm install
	pnpm --filter @verdict/api prisma:generate
	docker pull node:20-alpine

db-up: ## Start Postgres and block until healthy
	docker compose up -d --wait db

db-down: ## Stop Postgres (keep data)
	docker compose down

migrate: ## Apply migrations via `migrate deploy` (runs the raw-SQL triggers — NEVER db push)
	pnpm --filter @verdict/api prisma:deploy

seed: ## Seed users, problems, and test cases (idempotent)
	pnpm --filter @verdict/api seed

dev: setup db-up migrate seed ## One command: full stack up with seeded data
	pnpm dev

down: ## Stop everything (keep the DB volume)
	docker compose down

reset: ## Nuke the DB volume, then bring the stack back up seeded
	docker compose down -v
	$(MAKE) dev

prisma-generate: ## Regenerate the Prisma client
	pnpm --filter @verdict/api prisma:generate

test: ## Run all workspace tests
	pnpm test

lint: ## Lint all workspaces
	pnpm lint
