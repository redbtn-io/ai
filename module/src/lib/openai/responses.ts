import { openai } from './client';

export async function getResponse(options?: any) {
    if (!options) options = { model: 'gpt-3.5-turbo' }
    const response = await openai.responses.create(
        options
    );
    return response;
}
