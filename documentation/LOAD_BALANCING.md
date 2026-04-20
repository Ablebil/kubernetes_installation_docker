# **Pengujian & Visualisasi Load Balancing**

Dokumentasi ini menjelaskan langkah-langkah untuk memvisualisasikan dan menguji distribusi trafik (_Load Balancing_) pada aplikasi `login-app` yang berjalan di atas Kubernetes.

> **Catatan:** Konfigurasi _Sticky Sessions_ (Session Affinity), pendefinisian _Ingress Class_, serta penyesuaian jumlah _replicas_ menjadi 3 Pod **sudah diatur dan dieksekusi** pada fase _deployment_ sebelumnya.

---

## **1. Visualisasi Load Balancing pada Antarmuka (Frontend)**

Untuk membuktikan secara visual bahwa trafik telah didistribusikan ke Pod yang berbeda, sebuah _widget floating_ ditambahkan pada antarmuka aplikasi. _Widget_ ini akan memanggil _endpoint_ API `/server-info` dan menampilkan ID dari Pod yang melayani _request_ tersebut.

Tambahkan kode berikut pada bagian paling bawah _file_ `k8s-login-app/app/public/dashboard.js`:

```javascript
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
```

---

## **2. Script Otomasi Pengujian Load Balancing (CLI)**

Karena aplikasi telah dikonfigurasi menggunakan _Sticky Sessions_ untuk menjaga data _login_, pengujian manual via _refresh browser_ akan selalu diarahkan ke Pod yang sama. 

Untuk menyimulasikan trafik dari banyak pengguna secara akurat dan membuktikan _Load Balancer_ tetap bekerja, buat _file script_ pengujian `lb-test.sh` di Master Node:

```bash
nano lb-test.sh
```

Masukkan _script_ Bash berikut:

```bash
#!/bin/bash

TARGET_URL="https://pal-k8s.bccdev.id/server-info"

echo "========================================================="
echo "TESTING LOAD BALANCER WITH STICKY SESSION"
echo "========================================================="

echo -e "\nTEST 1: Simulating 10 New Users (Without Cookie)"
echo "---------------------------------------------------------"
for i in {1..10}; do
    POD_NAME=$(curl -s $TARGET_URL | grep -o '"podName":"[^"]*"' | cut -d'"' -f4)
    echo "Request from User $i served by : $POD_NAME"
done

echo -e "\nTEST 2: Simulating 1 User Navigating (With Cookie)"
echo "---------------------------------------------------------"
curl -s -c cookie.txt $TARGET_URL > /dev/null

for i in {1..10}; do
    POD_NAME=$(curl -s -b cookie.txt $TARGET_URL | grep -o '"podName":"[^"]*"' | cut -d'"' -f4)
    echo "Click number $i served by      : $POD_NAME"
done

rm -f cookie.txt
echo -e "\nTesting Completed!"
```

---

## **3. Eksekusi dan Validasi Pengujian**

Beri hak akses eksekusi pada _script_ dan jalankan perintah pengujian:

```bash
chmod +x lb-test.sh
./lb-test.sh
```

### **Analisis Hasil Output:**
* **TEST 1 (Tanpa Cookie):** Menunjukkan _output_ ID Pod yang bervariasi (terdistribusi secara probabilistik ke 3 Pod yang berbeda). Hal ini memvalidasi bahwa Nginx Ingress mendistribusikan trafik masuk secara murni kepada _user_ baru (_Load Balancing_ berfungsi).
* **TEST 2 (Dengan Cookie):** Menunjukkan _output_ ID Pod yang sama persis berturut-turut. Hal ini memvalidasi bahwa anotasi _Sticky Session_ Nginx berhasil mendeteksi dan mengunci sesi _user_ lama untuk mencegah _session loss_.