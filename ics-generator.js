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
    lines.push('X-WR-TIMEZONE:UTC');
    
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

// Format date for ICS format (YYYYMMDDTHHMMSSZ)
function formatICSDate(date) {
    const pad = (n) => String(n).padStart(2, '0');
    
    const year = date.getUTCFullYear();
    const month = pad(date.getUTCMonth() + 1);
    const day = pad(date.getUTCDate());
    const hours = pad(date.getUTCHours());
    const minutes = pad(date.getUTCMinutes());
    const seconds = pad(date.getUTCSeconds());
    
    return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
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
