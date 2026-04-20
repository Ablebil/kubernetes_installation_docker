document.addEventListener('DOMContentLoaded', function() {

// Menampilkan info server yang menangani request
    fetch('/server-info')
    .then(response => response.json())
    .then(data => {
        const serverInfoDiv = document.createElement('div');
        serverInfoDiv.style.position = 'fixed';
        serverInfoDiv.style.bottom = '10px';
        serverInfoDiv.style.right = '10px';
        serverInfoDiv.style.padding = '5px 10px';
        serverInfoDiv.style.background = '#333';
        serverInfoDiv.style.color = 'white';
        serverInfoDiv.style.fontFamily = 'monospace';
        serverInfoDiv.style.fontSize = '12px';
        serverInfoDiv.style.borderRadius = '5px';
        serverInfoDiv.style.zIndex = '9999';
        serverInfoDiv.textContent = `Served by: ${data.podName}`;
        document.body.appendChild(serverInfoDiv);
    })
    .catch(err => console.error('Error fetching server info:', err));
    
    // Check if user is logged in
    fetch('/auth/status')
        .then(response => response.json())
        .then(data => {
            if (!data.authenticated) {
                window.location.href = 'index.html';
                return;
            }
            
            // Set welcome message
            document.getElementById('welcome-message').textContent = `Welcome, ${data.username}`;
            
            // Load user uploads
            loadUploads();
        })
        .catch(error => {
            console.error('Auth error:', error);
            window.location.href = 'index.html';
        });
    
    // Handle logout
    document.getElementById('logout-btn').addEventListener('click', function() {
        fetch('/logout')
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    window.location.href = 'index.html';
                }
            })
            .catch(error => {
                console.error('Logout error:', error);
            });
    });
    
    // Handle image upload
    document.getElementById('uploadForm').addEventListener('submit', function(e) {
        e.preventDefault();
        
        const fileInput = document.getElementById('image');
        const messageDiv = document.getElementById('upload-message');
        
        if (!fileInput.files[0]) {
            messageDiv.className = 'error';
            messageDiv.textContent = 'Please select an image to upload';
            messageDiv.style.display = 'block';
            return;
        }
        
        const formData = new FormData();
        formData.append('image', fileInput.files[0]);
        
        fetch('/upload', {
            method: 'POST',
            body: formData,
        })
        .then(response => response.json())
        .then(data => {
            messageDiv.style.display = 'block';
            
            if (data.success) {
                messageDiv.className = 'success';
                messageDiv.textContent = data.message;
                document.getElementById('uploadForm').reset();
                document.getElementById('preview-image').style.display = 'none';
                
                // Reload uploads
                loadUploads();
            } else {
                messageDiv.className = 'error';
                messageDiv.textContent = data.message;
            }
        })
        .catch(error => {
            messageDiv.style.display = 'block';
            messageDiv.className = 'error';
            messageDiv.textContent = 'An error occurred. Please try again.';
            console.error('Upload error:', error);
        });
    });
    
    // Image preview
    document.getElementById('image').addEventListener('change', function() {
        const file = this.files[0];
        const previewImage = document.getElementById('preview-image');
        
        if (file) {
            const reader = new FileReader();
            
            reader.onload = function(e) {
                previewImage.src = e.target.result;
                previewImage.style.display = 'block';
            };
            
            reader.readAsDataURL(file);
        }
    });
    
    // Load user uploads
    function loadUploads() {
        const uploadsContainer = document.getElementById('uploads-container');
        
        fetch('/uploads')
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    if (data.uploads.length === 0) {
                        uploadsContainer.innerHTML = '<p>No uploads yet.</p>';
                        return;
                    }
                    
                    uploadsContainer.innerHTML = '';
                    data.uploads.forEach(upload => {
                        const uploadCard = document.createElement('div');
                        uploadCard.className = 'upload-card';
                        
                        uploadCard.innerHTML = `
                            <img src="/uploads/${upload.filename}" alt="${upload.original_name}">
                            <div class="upload-info">
                                <p>${upload.original_name}</p>
                                <p>${new Date(upload.upload_date).toLocaleString()}</p>
                            </div>
                        `;
                        
                        uploadsContainer.appendChild(uploadCard);
                    });
                }
            })
            .catch(error => {
                console.error('Error loading uploads:', error);
                uploadsContainer.innerHTML = '<p>Error loading uploads.</p>';
            });
    }
});