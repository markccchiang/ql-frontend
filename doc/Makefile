# Minimal makefile for Sphinx documentation.
#
#     make html      build doc/_build/html
#     make clean

SPHINXBUILD   ?= sphinx-build
SOURCEDIR      = .
BUILDDIR       = _build

.PHONY: help html clean Makefile

help:
	@$(SPHINXBUILD) -M help "$(SOURCEDIR)" "$(BUILDDIR)"

%: Makefile
	@$(SPHINXBUILD) -M $@ "$(SOURCEDIR)" "$(BUILDDIR)"
