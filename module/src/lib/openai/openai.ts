import { createAssistant, deleteAssistant, editAssistant, getAssistant } from "./assistants"
import { deleteFile, getFile, listFiles, readFile, uploadFile } from "./files"
import { createMessage, deleteMessage, editMessage, getMessage, listMessages } from "./messages"
import RealtimeAI from "./realtime"
import { cancelRun, editRun, getRun, listRuns, runThread, submitTools } from "./runs"
import { createThread, deleteThread, editThread, getThread } from "./threads"
import { createVoice } from "./voice"





export const Assistant = {
    cancelRun, createAssistant, createMessage, createThread, createVoice, deleteAssistant, deleteFile, deleteMessage, deleteThread, editAssistant, editMessage, editRun, editThread, getAssistant, getFile, getMessage, getRun, getThread, listFiles, listMessages, listRuns, readFile, runThread, submitTools, uploadFile, RealtimeAI
}




