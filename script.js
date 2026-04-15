let selectedFile = null;
let selectedFileBuffer = null;
let currentDeploymentUrl = null;

// DOM Elements
const vercelTokenInput = document.getElementById('vercelToken');
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const browseBtn = document.getElementById('browseBtn');
const projectInfo = document.getElementById('projectInfo');
const configSection = document.getElementById('configSection');
const deployBtn = document.getElementById('deployBtn');
const deployStatus = document.getElementById('deployStatus');
const resultCard = document.getElementById('resultCard');
const errorCard = document.getElementById('errorCard');

// Toggle Token Visibility
const toggleTokenBtn = document.getElementById('toggleTokenBtn');
toggleTokenBtn.addEventListener('click', () => {
    const type = vercelTokenInput.type === 'password' ? 'text' : 'password';
    vercelTokenInput.type = type;
    toggleTokenBtn.innerHTML = type === 'password' ? '<i class="fas fa-eye"></i>' : '<i class="fas fa-eye-slash"></i>';
});

// Upload Area Click
uploadArea.addEventListener('click', () => fileInput.click());
browseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
});

// Drag & Drop
uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '#fff';
});

uploadArea.addEventListener('dragleave', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = 'rgba(255,255,255,0.3)';
});

uploadArea.addEventListener('drop', async (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        await handleFile(files[0]);
    }
});

// File Input Change
fileInput.addEventListener('change', async (e) => {
    if (e.target.files.length > 0) {
        await handleFile(e.target.files[0]);
    }
});

// Handle File
async function handleFile(file) {
    if (!file.name.endsWith('.zip')) {
        alert('Hanya support file ZIP!');
        return;
    }
    
    if (file.size > 50 * 1024 * 1024) {
        alert('File terlalu besar! Max 50MB');
        return;
    }
    
    selectedFile = file;
    selectedFileBuffer = await file.arrayBuffer();
    
    document.getElementById('projectName').textContent = file.name;
    document.getElementById('projectSize').textContent = formatFileSize(file.size);
    projectInfo.style.display = 'block';
    configSection.style.display = 'block';
    
    const baseName = file.name.replace(/\.zip$/i, '');
    document.getElementById('projectNameInput').value = baseName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Remove Project
document.getElementById('removeProject').addEventListener('click', () => {
    selectedFile = null;
    selectedFileBuffer = null;
    projectInfo.style.display = 'none';
    configSection.style.display = 'none';
    fileInput.value = '';
});

// Deploy Button
deployBtn.addEventListener('click', async () => {
    const token = vercelTokenInput.value.trim();
    if (!token) {
        alert('Masukkan Vercel API Token dulu!');
        return;
    }
    
    if (!selectedFile || !selectedFileBuffer) {
        alert('Upload project ZIP dulu!');
        return;
    }
    
    const projectName = document.getElementById('projectNameInput').value.trim();
    if (!projectName) {
        alert('Masukkan project name!');
        return;
    }
    
    // Hide config, show deploy status
    configSection.style.display = 'none';
    deployStatus.style.display = 'block';
    resultCard.style.display = 'none';
    errorCard.style.display = 'none';
    
    // Start deployment
    await realDeployToVercel(token, projectName, selectedFileBuffer);
});

// REAL DEPLOY KE VERCEL API
async function realDeployToVercel(token, projectName, fileBuffer) {
    const logConsole = document.getElementById('logConsole');
    const progressFill = document.getElementById('progressFill');
    const statusMessage = document.getElementById('statusMessage');
    
    const addLog = (msg, type = 'info') => {
        const logLine = document.createElement('div');
        logLine.className = 'log-line';
        logLine.style.color = type === 'error' ? '#ff4444' : '#00ff88';
        logLine.innerHTML = `[${new Date().toLocaleTimeString()}] ${msg}`;
        logConsole.appendChild(logLine);
        logConsole.scrollTop = logConsole.scrollHeight;
    };
    
    try {
        // Step 1: Extract ZIP dan siapkan files
        addLog('📦 Extracting ZIP file...');
        progressFill.style.width = '15%';
        
        const zip = await JSZip.loadAsync(fileBuffer);
        const files = {};
        
        for (const [path, file] of Object.entries(zip.files)) {
            if (!file.dir) {
                const content = await file.async('string');
                files[path] = { content };
            }
        }
        
        addLog(`✅ Extracted ${Object.keys(files).length} files`);
        progressFill.style.width = '30%';
        
        // Step 2: Build deployment payload
        addLog('🔑 Authenticating with Vercel API...');
        
        const framework = document.getElementById('frameworkSelect').value;
        const buildCommand = document.getElementById('buildCommand').value;
        const outputDir = document.getElementById('outputDir').value;
        
        const deploymentPayload = {
            name: projectName,
            files: files,
            projectSettings: {
                framework: framework || null,
                buildCommand: buildCommand || null,
                outputDirectory: outputDir || null,
                installCommand: 'npm install'
            }
        };
        
        progressFill.style.width = '50%';
        addLog('📤 Uploading to Vercel...');
        
        // Step 3: Call Vercel API
        const response = await fetch('https://api.vercel.com/v13/deployments', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(deploymentPayload)
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || `HTTP ${response.status}`);
        }
        
        const result = await response.json();
        addLog(`✅ Deployment created: ${result.id}`);
        progressFill.style.width = '70%';
        
        // Step 4: Poll deployment status
        statusMessage.textContent = 'Building on Vercel...';
        addLog('⚙️ Building project on Vercel edge network...');
        
        let deploymentReady = false;
        let attempts = 0;
        const maxAttempts = 30;
        
        while (!deploymentReady && attempts < maxAttempts) {
            await sleep(3000);
            
            const statusResponse = await fetch(`https://api.vercel.com/v13/deployments/${result.id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            const statusData = await statusResponse.json();
            addLog(`Status: ${statusData.readyState || 'Building...'}`);
            
            if (statusData.readyState === 'READY') {
                deploymentReady = true;
                currentDeploymentUrl = `https://${statusData.url}`;
            } else if (statusData.readyState === 'ERROR') {
                throw new Error('Build failed on Vercel');
            }
            
            progressFill.style.width = 70 + (attempts * 1);
            attempts++;
        }
        
        if (!deploymentReady) {
            throw new Error('Deployment timeout');
        }
        
        progressFill.style.width = '100%';
        addLog(`🎉 DEPLOYMENT SUCCESSFUL!`);
        addLog(`🌐 URL: ${currentDeploymentUrl}`);
        statusMessage.textContent = 'Deployment complete!';
        
        await sleep(1000);
        
        // Show success
        deployStatus.style.display = 'none';
        resultCard.style.display = 'block';
        document.getElementById('deployUrl').textContent = currentDeploymentUrl;
        
    } catch (error) {
        addLog(`❌ ERROR: ${error.message}`, 'error');
        statusMessage.textContent = 'Deployment failed';
        
        await sleep(1000);
        
        deployStatus.style.display = 'none';
        errorCard.style.display = 'block';
        document.getElementById('errorMessage').textContent = error.message;
    }
}

// Helper Functions
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Copy URL
document.getElementById('copyUrl')?.addEventListener('click', () => {
    const url = document.getElementById('deployUrl').textContent;
    navigator.clipboard.writeText(url);
    alert('URL copied!');
});

// Visit URL
document.getElementById('visitUrl')?.addEventListener('click', () => {
    if (currentDeploymentUrl) {
        window.open(currentDeploymentUrl, '_blank');
    }
});

// New Deployment
const newDeployBtns = document.querySelectorAll('#newDeploy, #newDeployError');
newDeployBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        selectedFile = null;
        selectedFileBuffer = null;
        projectInfo.style.display = 'none';
        configSection.style.display = 'block';
        deployStatus.style.display = 'none';
        resultCard.style.display = 'none';
        errorCard.style.display = 'none';
        fileInput.value = '';
        document.getElementById('logConsole').innerHTML = '<div class="log-line">[kinanimut] Starting deployment process...</div>';
    });
});