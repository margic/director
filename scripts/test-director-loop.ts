
import { DirectorService } from '../src/main/director-service';
import { AuthService } from '../src/main/auth-service';
import { RaceSession, GetNextSequenceResponse } from '../src/main/director-types';

// Mock AuthService (duck typing)
const mockAuthService = {
  getAccessToken: async () => "mock-token",
  getUserProfile: async () => ({ centerId: "mock-center-id" }),
} as unknown as AuthService;

// Mock Fetch
const mockSessions: RaceSession[] = [
  {
    raceSessionId: "session-1",
    name: "Test Session",
    status: "ACTIVE",
    centerId: "mock-center-id"
  }
];

const mockSequence: GetNextSequenceResponse = {
  sequenceId: "seq-1",
  createdAt: new Date().toISOString(),
  priority: "NORMAL",
  totalDurationMs: 2000,
  commands: [
    {
      id: "cmd-1",
      type: "LOG",
      payload: {
        message: "Starting Test Sequence",
        level: "INFO"
      }
    },
    {
      id: "cmd-2",
      type: "SWITCH_CAMERA",
      payload: {
        carNumber: "63",
        cameraGroup: "TV1",
        cameraNumber: 1
      }
    },
    {
      id: "cmd-3",
      type: "SWITCH_OBS_SCENE",
      payload: {
        sceneName: "Driver 63 Onboard",
        transition: "Fade",
        duration: 500
      }
    },
    {
      id: "cmd-4",
      type: "DRIVER_TTS",
      payload: {
        text: "Driver 63, you are on air.",
        voiceId: "default",
        channelId: "race-control"
      }
    },
    {
      id: "cmd-5",
      type: "VIEWER_CHAT",
      payload: {
        platform: "YOUTUBE",
        message: "Watch Driver 63 battle for the lead!"
      }
    },
    {
      id: "cmd-6",
      type: "WAIT",
      payload: {
        durationMs: 500
      }
    },
    {
      id: "cmd-7",
      type: "LOG",
      payload: {
        message: "Sequence Completed",
        level: "INFO"
      }
    }
  ]
};

// Mock global fetch
global.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = input.toString();
  console.log(`[MockFetch] ${init?.method || 'GET'} ${url}`);

  if (url.includes('/sessions') && !url.includes('/sequences')) {
    return {
      ok: true,
      status: 200,
      json: async () => mockSessions
    } as Response;
  }

  if (url.includes('/sequences/next')) {
    // Alternate between returning a sequence and no content
    const shouldReturnSequence = Math.random() > 0.5;
    
    if (shouldReturnSequence) {
      return {
        ok: true,
        status: 200,
        json: async () => mockSequence
      } as Response;
    } else {
      return {
        ok: true,
        status: 204,
        json: async () => null
      } as Response;
    }
  }

  return {
    ok: false,
    status: 404,
    statusText: "Not Found"
  } as Response;
};

async function runTest() {
  console.log("Starting Director Loop Test...");
  
  const directorService = new DirectorService(mockAuthService);

  // Start the service
  await directorService.start();

  // Wait for a bit to let the loop run
  console.log("Waiting for loop to execute...");
  await new Promise(resolve => setTimeout(resolve, 6000));

  // Stop the service
  directorService.stop();
  console.log("Test Completed.");
}

runTest().catch(console.error);
