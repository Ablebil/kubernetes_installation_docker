# **Deployment Aplikasi Login App & Konfigurasi Nginx**

Dokumentasi ini menjelaskan proses otomasi _deployment_ aplikasi `login-app` sebanyak 3 _replicas_ menggunakan Ansible, serta konfigurasi Nginx _Reverse Proxy_ untuk merutekan trafik ke aplikasi dan Headlamp.

---

## **1. Konfigurasi Tambahan Headlamp (Base URL)**

Agar Headlamp dapat diakses dengan lancar melalui _subpath_ `/headlamp` di Nginx tanpa _rewrite_ manual, _base URL_ pada Headlamp perlu diubah.

Jalankan perintah berikut di Master Node:

```bash
helm upgrade --install my-headlamp headlamp/headlamp \
  -n kube-system --reuse-values \
  --set config.baseURL=/headlamp
```

---

## **2. Penyesuaian File Deployment Kubernetes**

Sebelum mengeksekusi Ansible, dilakukan beberapa penyesuaian agar sesuai dengan spesifikasi dan arsitektur _environment_:

### Update Replicas menjadi 3

Ubah nilai `replicas: 2` menjadi `replicas: 3` pada _file_ `k8s-login-app/k8s/web-deployment.yaml` dan `k8s-login-app/k8s/web-deployment-lb.yaml`.

### Perbaikan Kompatibilitas Database

Karena spesifikasi VM tidak mendukung instruksi CPU tertentu untuk `mysql:8.0`, _image_ diubah menjadi `mariadb:10.11` pada _file_ `k8s-login-app/k8s/mysql-deployment.yaml`.

### Konfigurasi Ingress & Sticky Sessions

Untuk menangani _error_ 404 pada Kubernetes v1.31 dan mencegah _kick-back_ _session_ saat melakukan _login_, tambahkan `ingressClassName` dan _annotations session affinity_ pada _file_ `k8s-login-app/k8s/login-app-ingress.yaml`:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: login-app-ingress
  annotations:
    kubernetes.io/ingress.class: nginx
    nginx.ingress.kubernetes.io/ssl-redirect: "false"
    nginx.ingress.kubernetes.io/rewrite-target: /
    nginx.ingress.kubernetes.io/affinity: "cookie"
    nginx.ingress.kubernetes.io/session-cookie-name: "SERVERID"
spec:
  ingressClassName: nginx
  rules:
    - http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: login-app
                port:
                  number: 80
```

---

## **3. Persiapan Ansible (Inventory & Playbook)**

Setup dilakukan dari mesin lokal menggunakan Ansible dengan membagi _host_ menjadi dua bagian agar proses _build image_ Docker lebih efisien dan tidak membebani transfer jaringan.

### Buat File `host.ini`

```ini
[master]
master_node ansible_host=proxy.bccdev.id ansible_port=11031 ansible_user=dev ansible_ssh_private_key_file=~/.ssh/id_ed25519

[workers]
worker_node ansible_host=proxy.bccdev.id ansible_port=11032 ansible_user=dev ansible_ssh_private_key_file=~/.ssh/id_ed25519
```

### Buat File `playbook.yaml`

```yaml
- name: Setup Application and Build Docker Image
  hosts: all
  become: false
  vars:
    git_repo: "https://github.com/Ablebil/kubernetes_installation_docker.git"
    git_branch: main
    app_dir: "/home/dev/k8s-login-app-deployment"

  tasks:
    - name: Create app directory if it doesn't exist
      file:
        path: "{{ app_dir }}"
        state: directory

    - name: Clone git repository
      git:
        repo: "{{ git_repo }}"
        dest: "{{ app_dir }}"
        version: "{{ git_branch }}"
        clone: yes
        update: yes
        force: yes

    - name: Create data directory on worker nodes
      become: true
      file:
        path: /mnt/data
        state: directory
        mode: "0777"
      when: inventory_hostname in groups['workers']

    - name: Create server-patch.js file
      copy:
        content: |
          const os = require('os');
          const serverInfo = {
            hostname: os.hostname(),
            podName: process.env.POD_NAME || 'unknown',
            nodeName: process.env.NODE_NAME || 'unknown'
          };

          // Add this after the health route
          app.get('/server-info', (req, res) => {
            res.json(serverInfo);
          });

          // Insert this line before app.listen
          app.use((req, res, next) => {
            res.setHeader('X-Served-By', serverInfo.podName);
            next();
          });
        dest: "{{ app_dir }}/k8s-login-app/app/server-patch.js"

    - name: Apply server patch and Build Docker image
      shell: |
        cd {{ app_dir }}/k8s-login-app/app
        cat server-patch.js >> server.js
        docker build -t login-app:latest .
      args:
        executable: /bin/bash

- name: Deploy Application to Kubernetes
  hosts: master
  become: false
  vars:
    app_dir: "/home/dev/k8s-login-app-deployment"
    master_node_ip: 10.202.0.31

  tasks:
    - name: Clean up old deployments
      shell: |
        kubectl delete deployment login-app mysql --ignore-not-found
        kubectl delete service login-app mysql --ignore-not-found
        kubectl delete pvc mysql-pvc --ignore-not-found
        kubectl delete pv mysql-pv --ignore-not-found
        kubectl delete secret mysql-secret --ignore-not-found
      args:
        executable: /bin/bash
      ignore_errors: true

    - name: Deploy MySQL Database
      shell: |
        cd {{ app_dir }}/k8s-login-app
        kubectl apply -f k8s/mysql-secret.yaml
        kubectl apply -f k8s/mysql-pv.yaml
        kubectl apply -f k8s/mysql-pvc.yaml
        kubectl apply -f k8s/mysql-deployment.yaml
        kubectl apply -f k8s/mysql-service.yaml
      args:
        executable: /bin/bash

    - name: Wait for MySQL to be ready
      shell: |
        kubectl wait --for=condition=ready pod -l app=mysql --timeout=180s
      args:
        executable: /bin/bash
      ignore_errors: true

    - name: Deploy Standard Web Application
      shell: |
        cd {{ app_dir }}/k8s-login-app
        kubectl apply -f k8s/web-deployment.yaml
        kubectl apply -f k8s/web-service.yaml
      args:
        executable: /bin/bash

    - name: Deploy Load Balancer Configuration
      shell: |
        cd {{ app_dir }}/k8s-login-app
        kubectl apply -f k8s/web-deployment-lb.yaml
        kubectl create namespace ingress-nginx --dry-run=client -o yaml | kubectl apply -f -

        helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx || true
        helm repo update

        WORKER_NODE=$(kubectl get nodes --no-headers | grep -v master | grep -v control | head -1 | awk '{print $1}')

        helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
          --namespace ingress-nginx \
          --set controller.nodeSelector."kubernetes\\.io/hostname"=$WORKER_NODE \
          --set controller.service.type=NodePort \
          --set controller.service.nodePorts.http=30081

        kubectl apply -f k8s/login-app-ingress.yaml
        kubectl apply -f k8s/web-service-lb.yaml
      args:
        executable: /bin/bash
      ignore_errors: true

    - name: Configure Calico networking for correct IP detection
      shell: |
        kubectl set env daemonset/calico-node -n calico-system IP_AUTODETECTION_METHOD=can-reach={{ master_node_ip }}
        kubectl delete pod -n calico-system -l k8s-app=calico-node
        kubectl wait --for=condition=ready pod -l k8s-app=calico-node -n calico-system --timeout=180s
      args:
        executable: /bin/bash
      ignore_errors: true

    - name: Restart login-app deployment for DNS fix
      shell: |
        kubectl rollout restart deployment login-app
        kubectl rollout status deployment login-app --timeout=180s
      args:
        executable: /bin/bash

    - name: Display access information
      debug:
        msg: |
          Deployment completed!

          Standard application access:
          http://{{ master_node_ip }}:30080

          Load balanced application access:
          http://{{ master_node_ip }}:30081

          Login credentials:
          Username: admin
          Password: admin123
```

---

## **4. Eksekusi Playbook Ansible**

Jalankan perintah berikut di mesin lokal untuk memulai otomasi deployment:

```bash
ansible-playbook -i host.ini playbook.yaml
```

---

## **5. Konfigurasi Nginx (Reverse Proxy)**

Agar aplikasi dan Headlamp dapat diakses publik melalui domain tanpa menyertakan _port_, konfigurasikan _Reverse Proxy_ menggunakan Nginx di Master Node.

Edit atau buat _file_ konfigurasi di `/etc/nginx/sites-available/app`:

```bash
sudo nano /etc/nginx/sites-available/app
```

Masukkan konfigurasi berikut:

```nginx
server {
    listen 80;
    server_name pal-k8s.bccdev.id;

    location / {
        proxy_pass http://10.202.0.31:30081;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        client_max_body_size 5M;
        proxy_read_timeout 90;
    }

    location /headlamp {
        return 301 /headlamp/;
    }

    location /headlamp/ {
        proxy_pass http://10.202.0.31:31963;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Prefix /headlamp;

        # WebSocket support (diperlukan untuk Headlamp)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Aktivasi konfigurasi dan _reload_ layanan Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/app /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## **Hasil Deployment**

Setelah seluruh konfigurasi selesai:

- Aplikasi `login-app` dengan 3 _replicas_ dapat diakses melalui domain `http://pal-k8s.bccdev.id`.
- Headlamp dapat diakses melalui `http://pal-k8s.bccdev.id/headlamp`.
