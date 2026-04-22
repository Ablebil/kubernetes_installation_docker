# **Dokumentasi Implementasi: Kubernetes Monitoring & Autoscaling**

Dokumentasi ini menjelaskan langkah-langkah instalasi stack monitoring (Prometheus, Grafana), instrumentasi aplikasi Node.js, hingga pengujian _Horizontal Pod Autoscaler_ (HPA) menggunakan beban trafik nyata.

---

## **1. Persiapan Baseline Cluster**

Sebelum instalasi, pastikan klaster dalam kondisi sehat dan resource mencukupi.

1.  **Cek Informasi Klaster:**
    ```bash
    kubectl cluster-info
    kubectl get nodes -o wide
    ```
2.  **Siapkan Namespace Khusus:**
    ```bash
    kubectl create ns monitoring
    ```

---

## **2. Instalasi Metrics Server**

Metrics Server wajib ada agar `kubectl top` dan HPA bisa membaca data CPU/RAM.

1.  **Apply Manifest:**
    ```bash
    git clone https://github.com/Widhi-yahya/kubernetes_installation_docker.git
    cd kubernetes_installation_docker/
    kubectl apply -f metrics-server.yaml
    ```
2.  **Verifikasi:**
    ```bash
    kubectl top nodes
    kubectl top pods -A
    ```

---

## **3. Instalasi Kube Prometheus Stack (Helm)**

Menginstal paket lengkap Prometheus dan Grafana.

1.  **Tambah Repo & Update:**
    ```bash
    helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
    helm repo update
    ```
2.  **Instalasi dengan Konfigurasi Khusus:**
    Gunakan konfigurasi `insecureSkipVerify` agar Prometheus bisa menarik data metrik kontainer (_cAdvisor_) meskipun sertifikat Kubelet tidak dikenal secara resmi.
    ```bash
    helm upgrade --install prometheus prometheus-community/kube-prometheus-stack \
      --namespace monitoring \
      --set prometheus.prometheusSpec.serviceMonitorSelectorNilUsesHelmValues=false \
      --set grafana.service.type=NodePort \
      --set kubelet.serviceMonitor.insecureSkipVerify=true \
      --set grafana.grafana\.ini.server.root_url="https://pal-k8s.bccdev.id/grafana/" \
      --set grafana.grafana\.ini.server.serve_from_sub_path=true
    ```

---

## **4. Akses dan Konfigurasi Grafana**

1.  **Ambil Password Admin:**
    ```bash
    kubectl get secret -n monitoring prometheus-grafana -o jsonpath='{.data.admin-password}' | base64 -d; echo
    ```
2.  **Konfigurasi Nginx Ingress:**
    Pastikan tidak ada konflik rute `/login`. Hapus blok rute statis `/login` di konfigurasi Nginx jika ada, agar tidak mengganggu proses login aplikasi `login-app`.
3.  **Validasi Datasource:**
    Buka Grafana -> **Connections** -> **Data sources** -> **Prometheus**. Klik **Save & test**. Pastikan muncul pesan _Data source is working_.

---

## **5. Instrumentasi Aplikasi & ServiceMonitor**

Agar metrik spesifik aplikasi `login-app` (seperti jumlah request HTTP) terbaca oleh Prometheus.

1.  **Update Kode Aplikasi (`server.js`):**
    Tambahkan library `prom-client` dan `express-prom-bundle` sebagai middleware untuk mengekspos endpoint `/metrics`.
2.  **Update Service YAML:**
    Pastikan service `login-app` memiliki nama port `http` agar bisa dikenali oleh ServiceMonitor.
    ```yaml
    spec:
      ports:
        - name: http
          port: 80
          targetPort: 3000
    ```
3.  **Apply ServiceMonitor:**
    ```bash
    kubectl apply -f login-app-monitor.yaml
    ```
4.  **Verifikasi Target:**
    Cek di UI Prometheus (Status -> Targets), pastikan target `login-app` berstatus **UP**.

---

## **6. Visualisasi Dashboard**

**Import Dashboard Standar:**
Masukkan ID berikut di menu Import Grafana:

- `6417` (Kubernetes Cluster Overview)
- `8588` (Kubernetes Deployment Overview)
- `11663` (Kubernetes Pod Monitoring)

---

## **7. Konfigurasi Horizontal Pod Autoscaler (HPA)**

Implementasi autoscaling otomatis berdasarkan penggunaan resource.

1.  **Syarat Resources:** Pastikan Deployment `login-app` sudah memiliki definisi `resources.requests` (misal: CPU 100m).
2.  **Apply CPU HPA:**
    ```yaml
    apiVersion: autoscaling/v2
    kind: HorizontalPodAutoscaler
    metadata:
      name: login-app-hpa
    spec:
      scaleTargetRef:
        apiVersion: apps/v1
        kind: Deployment
        name: login-app
      minReplicas: 3
      maxReplicas: 10
      metrics:
        - type: Resource
          resource:
            name: cpu
            target:
              type: Utilization
              averageUtilization: 50
    ```
3.  **Catatan Penting:** Hindari menggunakan dua HPA (CPU dan Network) secara terpisah pada satu Deployment yang sama karena akan menyebabkan konflik `AmbiguousSelector`. Gunakan HPA CPU sebagai kontrol utama.

---

## **8. Load Testing dan Validasi Akhir**

Membuktikan bahwa sistem monitoring dan autoscaling bekerja saat beban trafik melonjak.

1.  **Persiapan Monitoring:**
    Buka satu terminal dan jalankan:
    ```bash
    kubectl get hpa -w
    ```
2.  **Eksekusi Beban Trafik:**
    Gunakan `hey` untuk menembak endpoint aplikasi secara masif:
    ```bash
    ~/go/bin/hey -z 5m -c 250 http://pal-k8s.bccdev.id/login
    ```
3.  **Hasil Pengamatan:**
    - Perhatikan kolom `TARGETS` pada HPA, persentase akan naik melebihi 50%.
    - Perhatikan kolom `REPLICAS`, jumlah pod akan otomatis bertambah (misal dari 3 menjadi 5 atau lebih) sesuai beban yang diterima.
