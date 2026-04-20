# **Kubernetes Cluster Setup**

Dokumentasi ini menjelaskan proses setup Kubernetes cluster mulai dari instalasi Docker hingga deployment dashboard menggunakan Headlamp.

Setup dilakukan pada **remote VM** dengan arsitektur:

- 1 Master Node
- 1 Worker Node
- Menggunakan **Calico CNI**
- Reverse proxy menggunakan **Nginx + Nginx Proxy Manager (NPM)**

---

## **Arsitektur Sistem**

Arsitektur sistem yang digunakan pada deployment ini adalah sebagai berikut:

```
Browser
│
▼
Nginx Proxy Manager (Public Server)
│
▼
VM Kubernetes (Master Node)
│
├── Nginx (Reverse Proxy Internal)
│
├── Kubernetes Cluster
│   ├── Master Node (Control Plane)
│   └── Worker Node
```

---

## **1. Install Docker (Master & Worker)**

### Tambahkan GPG Key Docker

```bash
wget -O - https://download.docker.com/linux/ubuntu/gpg > ./docker.key
gpg --no-default-keyring --keyring ./docker.gpg --import ./docker.key
gpg --no-default-keyring --keyring ./docker.gpg --export > ./docker-archive-keyring.gpg
sudo mv ./docker-archive-keyring.gpg /etc/apt/trusted.gpg.d/
```

### Install Docker

```bash
sudo add-apt-repository "deb [arch=amd64] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" -y
sudo apt update -y
sudo apt install -y git wget curl socat
sudo apt install -y docker-ce
```

---

## **2. Install CRI-Dockerd (Master & Worker)**

Kubernetes membutuhkan CRI, sehingga Docker perlu tambahan `cri-dockerd`.

```bash
VER=$(curl -s https://api.github.com/repos/Mirantis/cri-dockerd/releases/latest | grep tag_name | cut -d '"' -f 4 | sed 's/v//g')
wget https://github.com/Mirantis/cri-dockerd/releases/download/v${VER}/cri-dockerd-${VER}.amd64.tgz
tar xzvf cri-dockerd-${VER}.amd64.tgz
sudo mv cri-dockerd/cri-dockerd /usr/local/bin/
```

### Setup Service

```bash
wget https://raw.githubusercontent.com/Mirantis/cri-dockerd/master/packaging/systemd/cri-docker.service
wget https://raw.githubusercontent.com/Mirantis/cri-dockerd/master/packaging/systemd/cri-docker.socket
sudo mv cri-docker.socket cri-docker.service /etc/systemd/system/
sudo sed -i -e 's,/usr/bin/cri-dockerd,/usr/local/bin/cri-dockerd,' /etc/systemd/system/cri-docker.service
sudo systemctl daemon-reload
sudo systemctl enable cri-docker.service
sudo systemctl enable --now cri-docker.socket
```

---

## **3. Install Kubernetes (Master & Worker)**

### Tambahkan GPG Key

```bash
curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.31/deb/Release.key | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
```

### Tambahkan Repository

```bash
echo "deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.31/deb/ /" | sudo tee /etc/apt/sources.list.d/kubernetes.list
```

### Install Package

```bash
sudo apt-get update
sudo apt-get install -y kubelet kubeadm kubectl
```

### Hold Version

```bash
sudo apt-mark hold docker-ce kubelet kubeadm kubectl
```

---

## **4. Enable Networking (Master & Worker)**

```bash
cat <<EOF | sudo tee /etc/modules-load.d/k8s.conf
overlay
br_netfilter
EOF

sudo modprobe overlay
sudo modprobe br_netfilter
```

```bash
cat <<EOF | sudo tee /etc/sysctl.d/k8s.conf
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF

sudo sysctl --system
```

---

## **5. Install conntrack**

```bash
sudo apt install -y conntrack
```

---

## **6. Disable Swap (Master & Worker)**

```bash
sudo swapoff -a
```

Edit:

```bash
sudo nano /etc/fstab
```

Comment line yang mengandung `swap`.

---

## **7. Initialize Cluster (Master)**

```bash
sudo kubeadm init \
  --apiserver-advertise-address=10.202.0.31 \
  --cri-socket unix:///var/run/cri-dockerd.sock \
  --pod-network-cidr=192.168.0.0/16
```

---

## **8. Setup kubectl (Master)**

```bash
mkdir -p $HOME/.kube
sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
sudo chown $(id -u):$(id -g) $HOME/.kube/config
```

---

## **9. Install Calico Network (Master)**

```bash
kubectl create -f https://raw.githubusercontent.com/projectcalico/calico/v3.28.2/manifests/tigera-operator.yaml
curl https://raw.githubusercontent.com/projectcalico/calico/v3.28.2/manifests/custom-resources.yaml -O
kubectl create -f custom-resources.yaml
```

---

## **10. Join Worker ke Cluster (Worker)**

```bash
sudo kubeadm join <MASTER_IP>:6443 \
  --cri-socket unix:///var/run/cri-dockerd.sock \
  --token <TOKEN> \
  --discovery-token-ca-cert-hash <HASH>
```

---

## **11. Verifikasi Cluster (Master)**

```bash
kubectl get nodes
```

Semua node harus status **Ready**.

---

## **12. Install Metrics Server (Master)**

```bash
git clone https://github.com/mialeevs/kubernetes_installation_docker.git
cd kubernetes_installation_docker/
kubectl apply -f metrics-server.yaml
cd ..
rm -rf kubernetes_installation_docker/
```

---

## **13. Install Helm (Master)**

```bash
curl -fsSL -o get_helm.sh https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3
chmod +x get_helm.sh
./get_helm.sh
helm
```

---

## **14. Install Headlamp (Master)**

Karena Kubernetes Dashboard sudah deprecated, digunakan **Headlamp**.

### Add Repo

```bash
helm repo add headlamp https://kubernetes-sigs.github.io/headlamp/
helm repo update
```

### Install

```bash
helm install my-headlamp headlamp/headlamp --namespace kube-system
```

### Expose Service (NodePort)

```bash
kubectl expose deployment my-headlamp \
  --name headlamp-svc \
  --type NodePort \
  --port 80 \
  --target-port 4466 \
  -n kube-system
```

Cek service:

```bash
kubectl get svc -n kube-system
```

Port NodePort (misal `31963`) didapat dari sini.

---

## **15. Generate Token**

```bash
kubectl create token my-headlamp -n kube-system
```

Token ini digunakan untuk login ke Headlamp.

---

## **Hasil Setup**

Setelah seluruh langkah selesai:

- Kubernetes cluster berhasil dibuat
- Master dan Worker sudah terhubung
- Networking menggunakan Calico berjalan
- Metrics server aktif
- Headlamp berhasil di-deploy sebagai dashboard
