<div align="center">

<!-- Banner Image -->
<img src="assets/images/banner-logo.png" alt="Sim RaceCenter Director Banner" width="100%">

<br>

# **ORCHESTRATE THE CHAOS**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-FF831F?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-39.2.7-00ADEF?style=for-the-badge&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19.2.3-FF831F?style=for-the-badge&logo=react&logoColor=white)](https://reactjs.org/)
[![License](https://img.shields.io/badge/License-GPL--3.0-00ADEF?style=for-the-badge)](LICENSE)
[![Status](https://img.shields.io/badge/Status-Active-FF831F?style=for-the-badge)](https://github.com/margic/director)

**Website:** [simracecenter.com](https://www.simracecenter.com/) · **YouTube:** [@simracecenter](https://www.youtube.com/@simracecenter)

---

</div>

## 🏁 MISSION CONTROL

**Sim RaceCenter Director** is your mission-critical, on-premise execution engine—the nerve center bridging cloud-based Race Control with your local race center hardware and software ecosystem (OBS, iRacing, and beyond).

Think of it as the **broadcast control room** for high-performance sim racing operations. This Electron-powered application runs locally on your race center PC, providing secure, real-time orchestration of streams, telemetry, and race events.

<img src="assets/images/icon-logo.png" alt="Director Icon" width="120" align="right">

### **Core Capabilities**
- 🔐 **Secure Cloud Bridge** — Azure AD authentication with local execution
- 🎥 **OBS Integration** — Broadcast control at your fingertips
- 🏎️ **iRacing Telemetry** — Real-time race data streaming
- ⚡ **High-Performance Architecture** — TypeScript + Electron + React
- 🌐 **Cross-Platform** — Windows, Linux AppImage support

### **API Documentation**
- [OpenAPI Specification](https://simracecenter.com/api/openapi.yaml)
- [API Documentation](https://simracecenter.com/api/docs)

### **Security & Trust**
- [Security Design & Architecture](documents/security_design.md) — Read how we handle authentication and secure token storage.

---

## 🛠️ PIT CREW SETUP

### **Prerequisites**
Before entering the pit lane, ensure you have:
- **Node.js** 18+ ([Download](https://nodejs.org/))
- **npm** or **pnpm** package manager
- Git for version control

### **Installation Sequence**

1. **Clone the repository**
   ```bash
   git clone https://github.com/margic/director.git
   cd director
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your Azure AD and Race Control credentials
   ```

4. **Start development mode**
   ```bash
   npm run dev
   ```

### **Build for Production**

```bash
# Build the application
npm run build

# Create distributable packages
npm run dist
```

**Output locations:**
- **Windows:** `release/Sim RaceCenter Director Setup.exe`
- **Linux:** `release/Sim RaceCenter Director.AppImage`

---

## 🏎️ RACE OPERATIONS

### **Launch Protocol**

**Development Mode:**
```bash
npm run dev
```
This starts the Vite dev server and launches the Electron application with hot-reload enabled.

**Production Mode:**
Run the built executable from the `release/` directory after building.

### **Operational Workflow**

1. **Authentication** — Sign in with your Azure AD credentials
2. **Cloud Sync** — Director establishes secure connection to Race Control
3. **Local Integration** — Configure OBS, iRacing, and other integrations
4. **Go Live** — Execute broadcast operations from the control panel

### **Key Commands**

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development environment with hot-reload |
| `npm run build` | Compile TypeScript and build production assets |
| `npm run dist` | Create platform-specific installers |

---

## 📡 TELEMETRY DATA

### **Technical Stack**

<table>
<tr>
<td>

**Frontend Layer**
- ⚛️ React 19.2.3
- 🎨 Tailwind CSS 4.1
- 🔷 TypeScript 5.9.3
- ⚡ Vite 7.3

</td>
<td>

**Backend Layer**
- 🖥️ Electron 39.2.7
- 🔐 Azure MSAL Node
- 🛠️ Node.js APIs
- 📦 Electron Builder

</td>
</tr>
</table>

### **Architecture Overview**

```
┌─────────────────────────────────────────┐
│     Cloud Race Control (Azure)          │
│         (Command Center)                 │
└──────────────┬──────────────────────────┘
               │ Secure Bridge
               │ (Azure AD Auth)
┌──────────────▼──────────────────────────┐
│    Sim RaceCenter Director (Local)      │
│    ┌──────────────────────────────┐     │
│    │  Electron Main Process       │     │
│    │  - Auth Service              │     │
│    │  - IPC Handlers              │     │
│    └──────────┬───────────────────┘     │
│               │                          │
│    ┌──────────▼───────────────────┐     │
│    │  React Renderer              │     │
│    │  - Control Dashboard         │     │
│    │  - Broadcast Management      │     │
│    └──────────────────────────────┘     │
└──────────────┬──────────────────────────┘
               │
      ┌────────┴────────┐
      │                 │
┌─────▼─────┐    ┌─────▼─────┐
│    OBS    │    │  iRacing  │
│  Control  │    │ Telemetry │
└───────────┘    └───────────┘
```

### **Feature Matrix**

| Feature | Status | Description |
|---------|--------|-------------|
| 🔐 Azure AD Auth | ✅ Active | Secure cloud authentication |
| 🎥 OBS Integration | ✅ Active | Broadcast scene control |
| 🏎️ iRacing API | ✅ Active | Live telemetry streaming |
| 📊 Dashboard UI | ✅ Active | React-based control interface |
| 🌐 Cross-Platform | ✅ Active | Windows + Linux support |

<img src="assets/images/brand-lo.png" alt="Brand Guide" width="600">

---

## 🤝 JOIN THE TEAM

We're always looking for skilled engineers to join the pit crew. Whether you're interested in improving the control interface, optimizing broadcast integrations, or enhancing telemetry features—your contributions are welcome.

### **Contribution Guidelines**

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/telemetry-enhancement`)
3. **Commit** your changes (`git commit -m 'Add advanced telemetry overlay'`)
4. **Push** to your branch (`git push origin feature/telemetry-enhancement`)
5. **Open** a Pull Request

### **Development Standards**

- 📝 Follow TypeScript best practices
- 🧪 Write tests for new features (when test infrastructure exists)
- 📖 Update documentation for user-facing changes
- 🎨 Match the existing code style
- ✅ Ensure builds pass before submitting PRs

### **Communication Channels**

- 🐛 **Issues:** [GitHub Issues](https://github.com/margic/director/issues)
- 💬 **Discussions:** [GitHub Discussions](https://github.com/margic/director/discussions)
- 📺 **Updates:** [YouTube @simracecenter](https://www.youtube.com/@simracecenter)

---

## 📜 LICENSE

This project is licensed under the **GNU General Public License v3.0**.

See [LICENSE](LICENSE) for full details.

---

<div align="center">

**Built with ⚡ by the Sim RaceCenter Team**

[![Website](https://img.shields.io/badge/Visit-simracecenter.com-FF831F?style=for-the-badge)](https://www.simracecenter.com/)
[![YouTube](https://img.shields.io/badge/Subscribe-YouTube-00ADEF?style=for-the-badge&logo=youtube&logoColor=white)](https://www.youtube.com/@simracecenter)

*Race Director. Race Control. Race Smart.*

</div>
