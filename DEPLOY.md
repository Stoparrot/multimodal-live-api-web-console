# Deployment Guide for GitHub Pages

This document outlines how to deploy the Multimodal Live API Web Console to GitHub Pages.

## Prerequisites

1. **GitHub Account**: You need a GitHub account to host the app on GitHub Pages.
2. **Gemini API Key**: You need a valid Gemini API key. You can get one from [Google AI Studio](https://aistudio.google.com/apikey).

## Setup Steps

### 1. Fork or Clone the Repository

First, fork or clone this repository to your GitHub account.

### 2. Update package.json

Update the `homepage` field in `package.json` to match your GitHub username:

```json
"homepage": "https://YOUR_GITHUB_USERNAME.github.io/multimodal-live-api-web-console"
```

### 3. Set Up Repository Secrets

1. Go to your repository on GitHub
2. Navigate to "Settings" > "Secrets and variables" > "Actions"
3. Create a new repository secret:
   - Name: `GEMINI_API_KEY`
   - Value: Your Gemini API key

### 4. Enable GitHub Pages

1. Go to your repository on GitHub
2. Navigate to "Settings" > "Pages"
3. Under "Build and deployment", select:
   - Source: "GitHub Actions"

### 5. Deploy Manually

You can deploy manually by:

1. Pushing to the main branch (this will trigger the workflow)
2. Or, going to the "Actions" tab in your repository, selecting the "Deploy to GitHub Pages" workflow, and clicking "Run workflow"

## Local Development and Testing

### Install Dependencies

```bash
npm install
```

### Create a .env File

Create a `.env` file in the root directory with your API key:

```
REACT_APP_GEMINI_API_KEY=your_api_key_here
```

### Run Locally

```bash
npm start
```

### Build for Production

```bash
npm run build
```

## Mobile Testing

The app is designed to work on mobile devices. You can test it by:

1. Running the app locally with `npm start`
2. Accessing it via your local IP address from a mobile device on the same network
3. Or using browser developer tools to simulate mobile devices

## Troubleshooting

### API Key Issues

If you're having issues with the API key:
- Make sure it's correctly set in the GitHub secret
- Check that the `.env` file is correctly formatted
- Verify the API key is valid by testing it locally

### Deployment Issues

If the GitHub Actions workflow fails:
- Check the workflow run logs for specific errors
- Make sure all repository secrets are correctly set
- Verify your package.json has the correct homepage URL 