// Generate ICS (iCalendar) file content
function generateICS(events) {
    const lines = [];
    
    // Calendar header
    lines.push('BEGIN:VCALENDAR');
    lines.push('VERSION:2.0');
    lines.push('PRODID:-//AI Calendar Generator//EN');
    lines.push('CALSCALE:GREGORIAN');
    lines.push('METHOD:PUBLISH');
    lines.push('X-WR-CALNAME:My Calendar');
    // Removed X-WR-TIMEZONE to allow for floating time
    
    // Add each event
    events.forEach(event => {
        lines.push('BEGIN:VEVENT');
        
        // Generate unique ID
        const uid = `${event.id}@ai-calendar-generator.com`;
        lines.push(`UID:${uid}`);
        
        // Timestamp
        const now = formatICSDate(new Date());
        lines.push(`DTSTAMP:${now}`);
        
        // Event times
        const start = formatICSDate(event.start);
        const end = formatICSDate(event.end);
        lines.push(`DTSTART:${start}`);
        lines.push(`DTEND:${end}`);
        
        // Event title (required)
        lines.push(`SUMMARY:${escapeICS(event.title)}`);
        
        // Location (optional)
        if (event.location) {
            lines.push(`LOCATION:${escapeICS(event.location)}`);
        }
        
        // Status
        lines.push('STATUS:CONFIRMED');
        lines.push('SEQUENCE:0');
        lines.push('TRANSP:OPAQUE');
        
        lines.push('END:VEVENT');
    });
    
    // Calendar footer
    lines.push('END:VCALENDAR');
    
    // Join with proper line endings
    return lines.join('\r\n');
}

// Format date for ICS format (YYYYMMDDTHHMMSS) - Floating Time
function formatICSDate(date) {
    const pad = (n) => String(n).padStart(2, '0');
    
    // CHANGED: Use Local Time methods instead of UTC
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    
    // CHANGED: Removed 'Z' at the end to strictly follow Floating Time
    return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

// Escape special characters for ICS format
function escapeICS(text) {
    if (!text) return '';
    
    return text
        .replace(/\\/g, '\\\\')   // Backslash
        .replace(/;/g, '\\;')      // Semicolon
        .replace(/,/g, '\\,')      // Comma
        .replace(/\n/g, '\\n')     // Newline
        .replace(/\r/g, '');       // Remove carriage return
}