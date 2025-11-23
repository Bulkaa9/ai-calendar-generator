// Global array to store events
let events = [];

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    updateEventsList();
});

// Add event function
function addEvent() {
    // Get values from form
    const title = document.getElementById('event-title').value.trim();
    const start = document.getElementById('event-start').value;
    const end = document.getElementById('event-end').value;
    const location = document.getElementById('event-location').value.trim();
    
    // Validation
    if (!title) {
        alert('⚠️ Please enter an event title');
        return;
    }
    
    if (!start || !end) {
        alert('⚠️ Please select start and end times');
        return;
    }
    
    const startDate = new Date(start);
    const endDate = new Date(end);
    
    if (endDate <= startDate) {
        alert('⚠️ End time must be after start time');
        return;
    }
    
    // Create event object
    const event = {
        id: Date.now(), // Simple unique ID
        title: title,
        start: startDate,
        end: endDate,
        location: location
    };
    
    // Add to events array
    events.push(event);
    
    // Update display
    updateEventsList();
    
    // Clear form
    document.getElementById('event-title').value = '';
    document.getElementById('event-start').value = '';
    document.getElementById('event-end').value = '';
    document.getElementById('event-location').value = '';
    
    // Success message
    showMessage('✅ Event added successfully!');
}

// Update events list display
function updateEventsList() {
    const listEl = document.getElementById('events-list');
    const countEl = document.getElementById('event-count');
    const downloadBtn = document.getElementById('download-btn');
    
    // Update count
    countEl.textContent = events.length;
    
    // Enable/disable download button
    downloadBtn.disabled = events.length === 0;
    
    // If no events, show empty state
    if (events.length === 0) {
        listEl.innerHTML = '<p class="empty-state">No events yet. Add your first event! 👈</p>';
        return;
    }
    
    // Sort events by start date
    events.sort((a, b) => a.start - b.start);
    
    // Generate HTML for each event
    listEl.innerHTML = events.map(event => `
        <div class="event-item">
            <div class="event-info">
                <h4>${escapeHtml(event.title)}</h4>
                <p>📅 ${formatDate(event.start)}</p>
                <p>⏰ ${formatTime(event.start)} - ${formatTime(event.end)}</p>
                ${event.location ? `<p>📍 ${escapeHtml(event.location)}</p>` : ''}
            </div>
            <button class="btn-delete" onclick="deleteEvent(${event.id})">
                🗑️ Delete
            </button>
        </div>
    `).join('');
}

// Delete event function
function deleteEvent(id) {
    if (confirm('Are you sure you want to delete this event?')) {
        events = events.filter(event => event.id !== id);
        updateEventsList();
        showMessage('🗑️ Event deleted');
    }
}

// Format date for display
function formatDate(date) {
    return date.toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

// Format time for display
function formatTime(date) {
    return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Show temporary message
function showMessage(message) {
    // Simple alert for now (we can make this prettier later)
    alert(message);
}

// Download calendar function
function downloadCalendar() {
    if (events.length === 0) {
        alert('⚠️ No events to download');
        return;
    }
    
    // Generate ICS content (using our ics-generator.js)
    const icsContent = generateICS(events);
    
    // Create download
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `my-calendar-${Date.now()}.ics`;
    link.click();
    
    showMessage('✅ Calendar downloaded! You can now import it into Google Calendar, Outlook, or Apple Calendar.');
}
