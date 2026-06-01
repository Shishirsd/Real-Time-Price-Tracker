# 🏭 Real-Time Aluminum Price Tracker

A high-performance, real-time tracking dashboard for Aluminum spot prices in the **United Arab Emirates (AED)** and **Saudi Arabia (SAR)**. Built with Node.js and Vanilla JavaScript, this tool provides a premium dark-themed interface, live auto-refreshing prices via Server-Sent Events (SSE), interactive sparkline charts, and automated CSV history logging.

<img width="1439" height="751" alt="Capture" src="https://github.com/user-attachments/assets/aa0d7f36-3e47-43da-8243-a721f290d3a3" />
<img width="1440" height="747" alt="Capture2" src="https://github.com/user-attachments/assets/063b1eb1-a067-4e4c-b232-8e9df671e993" />


## ✨ Features

- **Live Data Scraping**: Extracts up-to-the-minute aluminum prices and USD exchange rates using lightweight HTML parsing.
- **Real-Time Push Updates**: Utilizes Server-Sent Events (SSE) to push live updates to the frontend dashboard seamlessly.
- **Configurable Auto-Refresh**: Select your desired refresh interval (30s up to 1h) directly from the dashboard.
- **Premium Glassmorphism UI**: Beautiful, fully responsive dark mode design with sleek animations.
- **Interactive Price Charts**: Auto-updating visual price trends rendered via the HTML5 Canvas API.
- **Data Persistence**: Automatically logs every data point into a local `price_history.csv` file.

## 🛠️ Tech Stack

- **Backend**: Node.js, Express.js, Cheerio (for lightweight HTML scraping)
- **Frontend**: HTML5, CSS3 (CSS Variables, Flexbox/Grid), Vanilla JavaScript (Canvas API, SSE)
- **Containerization**: Docker

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- [Docker](https://www.docker.com/) (Optional, for containerized deployment)

### Local Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Shishirsd/Real-Time-Price-Tracker.git
   cd Real-Time-Price-Tracker
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the server:
   ```bash
   npm start
   ```

4. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

### 🐳 Running with Docker

```bash
# Build the image
docker build -t aluminum-price-tracker .

# Run the container (with persistent CSV storage)
docker run -p 3000:3000 -v "$(pwd)/price_history.csv:/usr/src/app/price_history.csv" -d aluminum-price-tracker
```

## 🌐 API Endpoints

The backend exposes several useful REST endpoints:
- `GET /api/prices` - Fetch current prices and exchange rates.
- `GET /api/history?limit=50` - Retrieve historical price data.
- `POST /api/refresh` - Trigger a manual data fetch.
- `GET /api/events` - SSE endpoint for real-time streaming.

## 📝 Disclaimer
Data is sourced from public web data. Prices shown are for informational purposes only and may be delayed. This tool is not intended for trading decisions or financial advice.

---
*Built by **SHISHIR***
