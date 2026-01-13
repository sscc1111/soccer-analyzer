# Analyzer Service Deployment Guide

This guide covers deploying the soccer-analyzer service to Google Cloud Run.

## Prerequisites

1. **Google Cloud Project**
   - A GCP project with billing enabled
   - Project ID (e.g., `my-project-123`)

2. **Local Tools**
   - Docker Desktop installed and running
   - gcloud CLI installed and configured
   - Authenticated with gcloud: `gcloud auth login`

3. **Required GCP APIs**
   - Cloud Run API
   - Container Registry API
   - Cloud Build API
   - Secret Manager API

## Setup Steps

### 1. Configure Environment Variables

```bash
export GCP_PROJECT_ID="your-project-id"
export GCP_REGION="us-central1"  # Optional, defaults to us-central1
```

### 2. Create Secrets in Secret Manager

The analyzer service requires the Gemini API key:

```bash
# Create the secret
echo -n "your-gemini-api-key-here" | gcloud secrets create gemini-api-key \
    --replication-policy="automatic" \
    --data-file=-

# Grant the service account access to the secret
gcloud secrets add-iam-policy-binding gemini-api-key \
    --member="serviceAccount:soccer-analyzer@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
```

### 3. Create Service Account

```bash
# Create the service account
gcloud iam service-accounts create soccer-analyzer \
    --display-name="Soccer Analyzer Service"

# Grant necessary permissions
gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
    --member="serviceAccount:soccer-analyzer@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/storage.objectAdmin"

gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
    --member="serviceAccount:soccer-analyzer@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/datastore.user"
```

### 4. Deploy Using the Script

```bash
cd infra
chmod +x deploy-analyzer.sh
./deploy-analyzer.sh
```

### 5. Manual Deployment (Alternative)

If you prefer to deploy manually:

```bash
# Build the image
cd /path/to/soccer-analyzer
docker build -t gcr.io/${GCP_PROJECT_ID}/soccer-analyzer:latest \
    -f services/analyzer/Dockerfile .

# Push to GCR
docker push gcr.io/${GCP_PROJECT_ID}/soccer-analyzer:latest

# Deploy to Cloud Run
gcloud run services replace infra/cloud-run-service.yaml \
    --region=${GCP_REGION}
```

## Configuration

### Cloud Run Service Configuration

The service is configured in `infra/cloud-run-service.yaml`:

- **CPU**: 4 vCPU (for parallel video processing)
- **Memory**: 16 GiB (for ML operations and video buffers)
- **Timeout**: 3600 seconds (1 hour for long videos)
- **Concurrency**: 1 (one job at a time per instance)
- **Execution Environment**: gen2 (better performance)
- **CPU Throttling**: Disabled (consistent performance)

### Environment Variables

The following environment variables are configured automatically:

- `GEMINI_API_KEY`: From Secret Manager
- `NODE_ENV`: production
- `GCP_PROJECT_ID`: Your project ID
- `STORAGE_BUCKET`: Default storage bucket
- `PORT`: 8080 (Cloud Run default)
- `FFMPEG_LOG_LEVEL`: error
- `TMPDIR`: /tmp

### Dockerfile

The Dockerfile uses a multi-stage build:

1. **Builder Stage**
   - Installs build dependencies
   - Builds the monorepo packages
   - Compiles TypeScript to JavaScript

2. **Production Stage**
   - Minimal runtime dependencies
   - Only production node_modules
   - FFmpeg for video processing
   - Health check endpoint

## Testing

### Health Check

```bash
SERVICE_URL=$(gcloud run services describe soccer-analyzer \
    --region=${GCP_REGION} \
    --format="value(status.url)")

curl $SERVICE_URL/health
```

Expected response:
```json
{"status":"healthy","timestamp":"2024-01-09T12:00:00.000Z"}
```

### Process a Match

```bash
curl -X POST $SERVICE_URL \
    -H "Content-Type: application/json" \
    -d '{
        "matchId": "test-match-123",
        "jobId": "job-456",
        "type": "full"
    }'
```

## Monitoring

### View Logs

```bash
# Real-time logs
gcloud run services logs tail soccer-analyzer --region=${GCP_REGION}

# Recent logs
gcloud run services logs read soccer-analyzer --region=${GCP_REGION} --limit=50
```

### Metrics

View metrics in Cloud Console:
- https://console.cloud.google.com/run/detail/${GCP_REGION}/soccer-analyzer/metrics

Key metrics to monitor:
- Request count
- Request latency
- Instance count
- CPU utilization
- Memory utilization

## Troubleshooting

### Build Fails

1. **Docker daemon not running**
   - Start Docker Desktop
   - Verify: `docker ps`

2. **Missing dependencies**
   - Ensure pnpm-lock.yaml is up to date
   - Run `pnpm install` locally first

### Deployment Fails

1. **Permission denied**
   - Check service account has necessary roles
   - Verify: `gcloud projects get-iam-policy $GCP_PROJECT_ID`

2. **Secret not found**
   - Create the gemini-api-key secret
   - Grant access to the service account

### Runtime Errors

1. **Out of memory**
   - Increase memory limit in cloud-run-service.yaml
   - Check video size and processing requirements

2. **Timeout**
   - Increase timeoutSeconds in cloud-run-service.yaml
   - Max timeout is 3600 seconds (1 hour)

3. **FFmpeg not found**
   - Verify FFmpeg is installed in Dockerfile
   - Check build logs

## Updating the Service

### Update Code

```bash
# Make your changes
git add .
git commit -m "Update analyzer service"

# Redeploy
cd infra
./deploy-analyzer.sh
```

### Update Configuration

1. Edit `infra/cloud-run-service.yaml`
2. Redeploy: `./deploy-analyzer.sh`

### Update Secrets

```bash
# Update the secret value
echo -n "new-api-key" | gcloud secrets versions add gemini-api-key --data-file=-

# Cloud Run will automatically use the latest version
```

## Cost Optimization

### Reduce Costs

1. **Use minimum resources**: Start with 2 vCPU / 8GB and scale up if needed
2. **Reduce timeout**: Set to actual processing time + buffer
3. **Use Cloud Build**: Instead of local Docker builds
4. **Enable request timeout**: Prevent runaway jobs

### Estimated Costs

Based on us-central1 pricing:
- **CPU**: $0.00002400/vCPU-second
- **Memory**: $0.00000250/GiB-second
- **Requests**: $0.40 per million requests

Example: 100 jobs/day, 10 minutes each
- Daily: ~$11.52
- Monthly: ~$345

## Security Best Practices

1. **Service Account**: Use dedicated service account with minimal permissions
2. **Secrets**: Store sensitive data in Secret Manager
3. **IAM**: Restrict Cloud Run invoker role
4. **VPC**: Use VPC connector for private resources
5. **HTTPS**: Cloud Run provides automatic HTTPS

## Next Steps

- [ ] Set up Cloud Scheduler for periodic jobs
- [ ] Configure Cloud Tasks for job queue
- [ ] Add Cloud Monitoring alerts
- [ ] Set up CI/CD with Cloud Build
- [ ] Implement autoscaling policies
