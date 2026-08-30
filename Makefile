# Fetches Hugo into bin/ on first use. Nothing else needs installing.

HUGO_VERSION := 0.165.0
HUGO         := bin/hugo
BASE         ?= https://wegweiser.zone/

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / \
		{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

.PHONY: build
build: $(HUGO) ## Build the site into httpdocs/
	$(HUGO) --baseURL $(BASE) --gc --minify

.PHONY: serve
serve: $(HUGO) ## Serve it locally with live reload
	$(HUGO) server --bind 127.0.0.1 --port 1313

.PHONY: check
check: build ## Build, then fail on a link that goes nowhere
	scripts/check-links.sh httpdocs

.PHONY: hooks
hooks: ## Install the pre-commit hook that keeps the upload password out
	@ln -sf ../../scripts/pre-commit .git/hooks/pre-commit
	@echo "installed .git/hooks/pre-commit"

.PHONY: clean
clean: ## Remove the build output
	rm -rf httpdocs resources .hugo_build.lock

$(HUGO):
	@mkdir -p bin
	curl -fsSL "https://github.com/gohugoio/hugo/releases/download/v$(HUGO_VERSION)/hugo_$(HUGO_VERSION)_linux-amd64.tar.gz" \
		| tar -xz -C bin hugo
	@$(HUGO) version
