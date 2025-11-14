#!/bin/bash

# Deploy script for Google Cloud VM
# This script uploads the project to VM and sets up the environment

set -e  # Exit on error

# Configuration - EDIT THESE VALUES
VM_NAME="video-pipeline-vm"
VM_ZONE="europe-west1-b"
VM_USER="your-username"  # Your GCP username
PROJECT_DIR="video-pipeline"
REMOTE_DIR="~/projects/video-pipeline"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Video Pipeline - Deploy to GCP VM${NC}"
echo -e "${GREEN}========================================${NC}"

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}Error: gcloud CLI is not installed${NC}"
    echo "Install from: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Check if VM exists
echo -e "\n${YELLOW}Checking if VM exists...${NC}"
if ! gcloud compute instances describe $VM_NAME --zone=$VM_ZONE &> /dev/null; then
    echo -e "${RED}Error: VM '$VM_NAME' not found in zone '$VM_ZONE'${NC}"
    echo "Please create the VM first or update VM_NAME and VM_ZONE in this script"
    exit 1
fi

echo -e "${GREEN}✓ VM found${NC}"

# Create deployment archive (exclude unnecessary files)
echo -e "\n${YELLOW}Creating deployment archive...${NC}"
TEMP_ARCHIVE="/tmp/video-pipeline-deploy.tar.gz"

tar -czf $TEMP_ARCHIVE \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='video-pipeline/input/*' \
  --exclude='video-pipeline/output/*' \
  --exclude='video-pipeline/temp/*' \
  --exclude='*.log' \
  --exclude='.env' \
  video-pipeline/ \
  package.json \
  package-lock.json

echo -e "${GREEN}✓ Archive created${NC}"

# Upload to VM
echo -e "\n${YELLOW}Uploading to VM...${NC}"
gcloud compute scp $TEMP_ARCHIVE ${VM_NAME}:~/video-pipeline-deploy.tar.gz --zone=$VM_ZONE

echo -e "${GREEN}✓ Upload complete${NC}"

# Extract and setup on VM
echo -e "\n${YELLOW}Setting up on VM...${NC}"
gcloud compute ssh $VM_NAME --zone=$VM_ZONE --command="
  set -e

  echo 'Creating project directory...'
  mkdir -p ~/projects
  cd ~/projects

  echo 'Extracting archive...'
  tar -xzf ~/video-pipeline-deploy.tar.gz
  rm ~/video-pipeline-deploy.tar.gz

  echo 'Creating required directories...'
  mkdir -p video-pipeline/temp
  mkdir -p video-pipeline/output

  echo 'Installing Node.js dependencies...'
  cd video-pipeline
  npm install --production

  echo 'Setup complete!'
"

echo -e "${GREEN}✓ Setup complete${NC}"

# Clean up local archive
rm $TEMP_ARCHIVE

# Prompt for .env setup
echo -e "\n${YELLOW}========================================${NC}"
echo -e "${YELLOW}IMPORTANT: Environment Setup${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""
echo "The .env file was not uploaded for security reasons."
echo "You need to create it manually on the VM:"
echo ""
echo "1. Connect to VM:"
echo -e "   ${GREEN}gcloud compute ssh $VM_NAME --zone=$VM_ZONE${NC}"
echo ""
echo "2. Create .env file:"
echo -e "   ${GREEN}cd ~/projects/video-pipeline${NC}"
echo -e "   ${GREEN}nano .env${NC}"
echo ""
echo "3. Add your environment variables (see .env.example)"
echo ""
echo -e "${YELLOW}========================================${NC}"

# Offer to open SSH connection
read -p "Do you want to connect to the VM now to setup .env? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    gcloud compute ssh $VM_NAME --zone=$VM_ZONE
fi

echo -e "\n${GREEN}Deployment complete!${NC}"
