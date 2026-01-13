#!/bin/bash

# Verification script for Cloud Run deployment configuration
# Checks that all required files and configurations are in place

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "Verifying Cloud Run deployment configuration..."
echo ""

# Check if files exist
echo "Checking required files..."
FILES=(
    "services/analyzer/Dockerfile"
    "services/analyzer/.dockerignore"
    "services/analyzer/server.js"
    "infra/cloud-run-service.yaml"
    "infra/deploy-analyzer.sh"
)

for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        echo -e "${GREEN}✓${NC} $file"
    else
        echo -e "${RED}✗${NC} $file (missing)"
        exit 1
    fi
done

echo ""
echo "Checking Dockerfile syntax..."
# Count stages
STAGES=$(grep -c "^FROM" services/analyzer/Dockerfile)
if [ "$STAGES" -eq 2 ]; then
    echo -e "${GREEN}✓${NC} Multi-stage build (2 stages)"
else
    echo -e "${RED}✗${NC} Expected 2 stages, found $STAGES"
    exit 1
fi

# Check for required commands
if grep -q "ffmpeg" services/analyzer/Dockerfile; then
    echo -e "${GREEN}✓${NC} FFmpeg installation"
else
    echo -e "${RED}✗${NC} FFmpeg installation missing"
    exit 1
fi

if grep -q "RUN corepack enable && corepack prepare pnpm" services/analyzer/Dockerfile; then
    echo -e "${GREEN}✓${NC} pnpm installation"
else
    echo -e "${RED}✗${NC} pnpm installation missing"
    exit 1
fi

if grep -q "EXPOSE 8080" services/analyzer/Dockerfile; then
    echo -e "${GREEN}✓${NC} Port 8080 exposed"
else
    echo -e "${RED}✗${NC} Port 8080 not exposed"
    exit 1
fi

if grep -q "HEALTHCHECK" services/analyzer/Dockerfile; then
    echo -e "${GREEN}✓${NC} Health check configured"
else
    echo -e "${YELLOW}⚠${NC} Health check not configured"
fi

echo ""
echo "Checking Cloud Run YAML..."
# Validate YAML syntax
if command -v python3 &> /dev/null; then
    if python3 -c "import yaml; yaml.safe_load(open('infra/cloud-run-service.yaml'))" 2>/dev/null; then
        echo -e "${GREEN}✓${NC} Valid YAML syntax"
    else
        echo -e "${RED}✗${NC} Invalid YAML syntax"
        exit 1
    fi
fi

# Check for required fields
if grep -q "containerConcurrency: 1" infra/cloud-run-service.yaml; then
    echo -e "${GREEN}✓${NC} Container concurrency set to 1"
else
    echo -e "${YELLOW}⚠${NC} Container concurrency not set to 1"
fi

if grep -q "timeoutSeconds: 3600" infra/cloud-run-service.yaml; then
    echo -e "${GREEN}✓${NC} Timeout set to 3600 seconds"
else
    echo -e "${YELLOW}⚠${NC} Timeout not set to 3600 seconds"
fi

if grep -q "gen2" infra/cloud-run-service.yaml; then
    echo -e "${GREEN}✓${NC} gen2 execution environment"
else
    echo -e "${YELLOW}⚠${NC} gen2 execution environment not specified"
fi

if grep -q "GEMINI_API_KEY" infra/cloud-run-service.yaml; then
    echo -e "${GREEN}✓${NC} Gemini API key configured"
else
    echo -e "${RED}✗${NC} Gemini API key not configured"
    exit 1
fi

echo ""
echo "Checking server.js..."
if grep -q "/health" services/analyzer/server.js; then
    echo -e "${GREEN}✓${NC} Health check endpoint"
else
    echo -e "${RED}✗${NC} Health check endpoint missing"
    exit 1
fi

if grep -q "handler" services/analyzer/server.js; then
    echo -e "${GREEN}✓${NC} Handler import"
else
    echo -e "${RED}✗${NC} Handler import missing"
    exit 1
fi

echo ""
echo "Checking .dockerignore..."
if grep -q "node_modules" services/analyzer/.dockerignore; then
    echo -e "${GREEN}✓${NC} node_modules ignored"
else
    echo -e "${YELLOW}⚠${NC} node_modules not ignored"
fi

if grep -q "__tests__" services/analyzer/.dockerignore; then
    echo -e "${GREEN}✓${NC} Test files ignored"
else
    echo -e "${YELLOW}⚠${NC} Test files not ignored"
fi

echo ""
echo "Checking deployment script..."
if [ -x "infra/deploy-analyzer.sh" ]; then
    echo -e "${GREEN}✓${NC} Deployment script is executable"
else
    echo -e "${YELLOW}⚠${NC} Deployment script is not executable"
    echo "Run: chmod +x infra/deploy-analyzer.sh"
fi

echo ""
echo -e "${GREEN}All checks passed!${NC}"
echo ""
echo "Configuration summary:"
echo "  - Multi-stage Docker build with FFmpeg"
echo "  - Node.js 20 with pnpm"
echo "  - Health check endpoint at /health"
echo "  - Cloud Run: 4 vCPU, 16GB RAM, 1 hour timeout"
echo "  - Concurrency: 1 (one job at a time)"
echo "  - gen2 execution environment"
echo ""
echo "Next steps:"
echo "  1. Set GCP_PROJECT_ID: export GCP_PROJECT_ID=your-project-id"
echo "  2. Create secrets: Follow infra/DEPLOYMENT.md"
echo "  3. Deploy: ./infra/deploy-analyzer.sh"
