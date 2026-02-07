
import { DiscordService } from '../src/main/discord-service';

// 1. Initialize Service
console.log('--- Initializing DiscordService ---');
const service = new DiscordService();
console.log('Status:', service.getStatus());

// 2. Test Connection
async function testConnection() {
    console.log('\n--- Testing Connection ---');
    // SECURITY NOTE: This is intentionally a fake/invalid token for testing purposes.
    // Real Discord bot tokens should never be hardcoded and should be stored securely.
    const mockToken = "MOCK_BOT_TOKEN";
    const mockChannel = "123456789";
    
    try {
        await service.connect(mockToken, mockChannel);
        const status = service.getStatus();
        console.log('Status after connect:', status);
        
        if (status.connected && status.channelName?.includes(mockChannel)) {
            console.log('PASS: Connected successfully');
        } else {
            console.error('FAIL: Connection state mismatch');
        }
    } catch (error: any) {
        if (error.code === 'TokenInvalid') {
            console.log('PASS: Real API correctly rejected mock token.');
            console.log('This confirms the service is hitting the real Discord API.');
            process.exit(0);
        } else {
            console.error('FAIL: Unexpected error:', error);
            process.exit(1);
        }
    }
}

// 3. Test TTS Output
async function testTts() {
    console.log('\n--- Testing TTS Output ---');
    const text = "Drivers, start your engines.";
    
    // Initial state
    const sentBefore = service.getStatus().messagesSent;
    
    // Action
    await service.playTts(text);
    
    // Check state
    const status = service.getStatus();
    const sentAfter = status.messagesSent;
    
    console.log(`Messages Sent: ${sentBefore} -> ${sentAfter}`);
    console.log(`Last Message: "${status.lastMessage}"`);
    
    if (sentAfter === sentBefore + 1 && status.lastMessage === text) {
        console.log('PASS: Message processed');
    } else {
        console.error('FAIL: Message not recorded');
    }
}

// 4. Test Disconnect
async function testDisconnect() {
    console.log('\n--- Testing Disconnect ---');
    await service.disconnect();
    const status = service.getStatus();
    console.log('Status after disconnect:', status);
    
    if (!status.connected) {
        console.log('PASS: Disconnected successfully');
    } else {
        console.error('FAIL: Still connected');
    }
}

// Run All
(async () => {
    try {
        await testConnection();
        await testTts();
        await testDisconnect();
        console.log('\nDone.');
    } catch (e) {
        console.error(e);
    }
})();
