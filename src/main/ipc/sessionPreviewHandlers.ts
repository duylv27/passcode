import type { SessionsRepository } from '../db/sessionsRepository'
import { getSessionPreview } from '../agent/sessionPreview'

export interface SessionPreviewHandlers {
  getPreview(sessionId: string): Promise<string | null>
}

export function createSessionPreviewHandlers(sessionsRepo: SessionsRepository): SessionPreviewHandlers {
  return {
    async getPreview(sessionId: string): Promise<string | null> {
      const file = sessionsRepo.getSessionFile(sessionId)
      return getSessionPreview(file)
    }
  }
}
