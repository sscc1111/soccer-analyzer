#!/bin/bash

# Deployment script for soccer-analyzer Cloud Run service
# This script builds and deploys the analyzer service to Google Cloud Run

set -e

# Configuration
PROJECT_ID="${GCP_PROJECT_ID:-your-project-id}"
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="soccer-analyzer"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting deployment of ${SERVICE_NAME}...${NC}"

# Check if PROJECT_ID is set
if [ "$PROJECT_ID" = "your-project-id" ]; then
    echo -e "${RED}Error: Please set GCP_PROJECT_ID environment variable${NC}"
    echo "Example: export GCP_PROJECT_ID=my-project-123"
    exit 1
fi

# Check if user is logged in to gcloud
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
    echo -e "${RED}Error: Not logged in to gcloud. Run 'gcloud auth login'${NC}"
    exit 1
fi

# Set the project
echo -e "${YELLOW}Setting GCP project to ${PROJECT_ID}...${NC}"
gcloud config set project "$PROJECT_ID"

# Enable required APIs
echo -e "${YELLOW}Enabling required Google Cloud APIs...${NC}"
gcloud services enable \
    run.googleapis.com \
    containerregistry.googleapis.com \
    cloudbuild.googleapis.com \
    secretmanager.googleapis.com

# Build the Docker image
echo -e "${YELLOW}Building Docker image...${NC}"
cd "$(dirname "$0")/.."
docker build -t "$IMAGE_NAME:latest" -f services/analyzer/Dockerfile .

# Tag with timestamp for versioning
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
docker tag "$IMAGE_NAME:latest" "$IMAGE_NAME:$TIMESTAMP"

# Push to Google Container Registry
echo -e "${YELLOW}Pushing image to GCR...${NC}"
docker push "$IMAGE_NAME:latest"
docker push "$IMAGE_NAME:$TIMESTAMP"

# Update the YAML with actual project ID
echo -e "${YELLOW}Updating Cloud Run configuration...${NC}"
sed "s/PROJECT_ID/$PROJECT_ID/g" infra/cloud-run-service.yaml > /tmp/cloud-run-service-deploy.yaml

# Deploy to Cloud Run
echo -e "${YELLOW}Deploying to Cloud Run...${NC}"
gcloud run services replace /tmp/cloud-run-service-deploy.yaml \
    --region="$REGION"

# Clean up temporary file
rm /tmp/cloud-run-service-deploy.yaml

# Get the service URL
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
    --region="$REGION" \
    --format="value(status.url)")

echo -e "${GREEN}Deployment complete!${NC}"
echo -e "Service URL: ${GREEN}$SERVICE_URL${NC}"
echo -e "Image: ${GREEN}$IMAGE_NAME:$TIMESTAMP${NC}"
echo ""
echo -e "${YELLOW}To test the service:${NC}"
echo "curl -X POST $SERVICE_URL -H 'Content-Type: application/json' -d '{\"matchId\":\"test-123\"}'"
echo ""
echo -e "${YELLOW}To view logs:${NC}"
echo "gcloud run services logs read $SERVICE_NAME --region=$REGION --limit=50"
