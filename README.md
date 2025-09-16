# Queue Display System

A simple queuing system with a **ticket generator** and a **queue display**.  
Built with **Vite + React** (frontend) and a lightweight backend (HTML/JS/CSS).  

---

## 🚀 Features
- Take a ticket from the counter.
- Display live queue numbers on the display screen.
- Supports multiple counters.
- Clean responsive UI (optimized for big screens).

---

## 🖥️ Installation

### 1. Clone the Repository
```bash
git clone https://github.com/MD212325/Queue-Management-System
cd queue-display-system
```

### 2. Install Dependencies
Make sure [Node.js](https://nodejs.org/) (v22.14.0) is installed.  
Then run:
```bash
npm install
```

### 3. Run the server
```bash
node server.js
```

### 4. Build for Production
```bash
npm run build
```

### 5. Run in Development
```bash
npm run dev
```
This will start the system on:
```
http://localhost:5173
```
The production files will be in the `dist/` folder.

---

## 📂 Project Structure
```
queue-display-system/
├── display.html       # Main display screen
├── display.css        # Styling for display
├── src/               # React source files
├── public/            # Static assets
├── package.json       # Dependencies & scripts
└── README.md          # Documentation
```

---

## ⚡ Deploying to Another PC
1. Install [Node.js](https://nodejs.org/) on the target PC.  
2. Clone this repository:
   ```bash
   git clone https://github.com/YourUsername/queue-display-system.git
   cd queue-display-system
   ```
3. Run:
   ```bash
   npm install
   npm run dev
   ```
4. Open the URL shown in the terminal (usually `http://localhost:5173`).

---

## 🛠️ Tech Stack
- **Frontend**: React + Vite
- **Styling**: CSS
- **Backend/Logic**: JavaScript (Node.js)

---

## 📜 License
MIT License — free to use and modify.
