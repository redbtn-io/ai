/**
 * Simple web scraper utility
 * Replaces the legacy scrape node parser
 */

export async function fetchAndParse(url: string): Promise<{ title: string; content: string; text: string; contentLength: number; error?: string }> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RedBot/1.0; +http://redbtn.io)'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
    }
    
    const html = await response.text();
    
    // Simple regex-based extraction (robust enough for basic needs without adding deps)
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1] : url;
    
    // Remove script and style tags
    let content = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, "");
    content = content.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gim, "");
    
    // Remove HTML tags
    content = content.replace(/<[^>]+>/g, " ");
    
    // Normalize whitespace
    content = content.replace(/\s+/g, " ").trim();
    
    return { 
      title, 
      content, 
      text: content, 
      contentLength: content.length 
    };
  } catch (error) {
    return { 
      title: url, 
      content: "", 
      text: "",
      contentLength: 0,
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}
