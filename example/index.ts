import 'dotenv/config'
import { formatContextWithSummary } from '@redbtn/ai'

const conversation:any[] = [
  { role: 'user', content: 'Hello, how are you?' },
    { role: 'assistant', content: 'I am fine, thank you!' },
    { role: 'user', content: 'What is your name?' },
    { role: 'assistant', content: 'I am an AI assistant.' },
    { role: 'user', content: 'Can you help me with my homework?' },
    { role: 'assistant', content: 'Sure, what do you need help with?' },
    { role: 'user', content: 'I need help with math.' },
    { role: 'assistant', content: 'What kind of math do you need help with?' },
    { role: 'user', content: 'I need help with algebra.' },
    { role: 'assistant', content: 'What specific topic in algebra do you need help with?' },
    { role: 'user', content: 'I need help with solving equations.' },
    { role: 'assistant', content: 'I can help you with that. What kind of equations are you trying to solve?' },
    { role: 'user', content: 'I am trying to solve linear equations.' },
    { role: 'assistant', content: 'I can help you with that. What specific linear equation are you trying to solve?' },
]

const options: {
  model?: any;
  max_tokens?: number;
  buffer?: number;
} = {
  model: 'gpt-3.5-turbo',
  max_tokens: 100,
  buffer: 500,
};

(async () => {
  const result = await formatContextWithSummary(conversation, options)
  console.log(result)
})();
