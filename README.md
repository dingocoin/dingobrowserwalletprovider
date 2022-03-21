# Dingocoin Browser Extension Wallet Provider

Source code to host a node to serve browser extension wallet requests.

### Setup VPS

1. Obtain an Ubuntu (>= 20.04) VPS with root access and a static IPv4 address.

2. Login as the **root user** for the following steps.

3. Setup dependencies

   ```
   sudo apt -y install curl dirmngr apt-transport-https lsb-release ca-certificates
   curl -sL https://deb.nodesource.com/setup_12.x | sudo -E bash -
   sudo apt -y install nodejs gcc g++ make sqlite3
   npm install --global yarn
   ```

3. Allow only ports 22 (SSH) and 80 (HTTP) on the VPS:

   ```
   ufw reset
   ufw default deny incoming
   ufw allow 22
   ufw allow 80
   ufw enable
   ```

5. Setup the latest Dingocoin binaries and extract to `/root/dingocoin`:

   ```
   mkdir /root/dingocoin
   cd /root/dingocoin
   wget https://github.com/dingocoin/dingocoin/releases/download/v1.16.0.3/linux-binaries.zip
   unzip ./linux-binaries.zip
   rm ./linux-binaries.zip
   chmod +x ./*
   mkdir /root/.dingocoin
   echo 'txindex=1' > /root/.dingocoin/dingocoin.conf
   ```

6. Clone and setup this repo in `/root/dingobewp`:

   ```
   git clone https://github.com/rkbling/dingobrowserwalletprovider.git /root/dingobewp
   cd /root/bewp
   yarn install
   cd /root/bewp/database
   sqlite3 database.db
   .read dump.479673.sql
   (Exit sqlite3 prompt using CTRL+D)
   ```

7. Run Dingocoin daemon and wait for it to sync

   ```
   cd /root/dingocoin
   ./dingocoind
   ./dingocoin-cli getblockchaininfo        # Use this to check synced height.
   ```

 8. Run provider daemon

    ```
    cd /root/dingobewp
    sudo yarn start
    ```
