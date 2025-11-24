// Global array to store events
let events = [];
let currentDate = new Date();
let currentView = 'month';


// Helper function to get color for event
function getEventColor() {
    return { bg: 'rgba(24, 52, 85, 0.85)', border: 'rgb(24, 52, 85)', text: 'rgb(24, 52, 85)' };
}


// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    updateEventsList();
    renderCalendar();
});

// Toggle add event form
function toggleAddEvent() {
    const form = document.getElementById('add-event-form');
    const trigger = document.getElementById('add-trigger');
    
    if (form.style.display === 'none') {
        form.style.display = 'block';
        trigger.style.display = 'none';
    } else {
        form.style.display = 'none';
        trigger.style.display = 'flex';
    }
}

// Add event function
function addEvent() {
    const title = document.getElementById('event-title').value.trim();
    const start = document.getElementById('event-start').value;
    const end = document.getElementById('event-end').value;
    const location = document.getElementById('event-location').value.trim();
    const description = document.getElementById('event-description').value.trim();
    
    // Clear previous error states
    document.getElementById('event-title').classList.remove('error');
    document.getElementById('event-start').classList.remove('error');
    document.getElementById('event-end').classList.remove('error');
    
    // Validation with visual feedback
    let hasError = false;
    
    if (!title) {
        document.getElementById('event-title').classList.add('error');
        hasError = true;
    }
    
    if (!start) {
        document.getElementById('event-start').classList.add('error');
        hasError = true;
    }
    
    if (!end) {
        document.getElementById('event-end').classList.add('error');
        hasError = true;
    }
    
    if (hasError) {
        showCustomAlert('⚠️', 'Missing Required Fields', 'Please fill in all required fields (Title, Start Time, and End Time)');
        return;
    }
    
    const startDate = new Date(start);
    const endDate = new Date(end);
    
    if (endDate <= startDate) {
        document.getElementById('event-end').classList.add('error');
        showCustomAlert('⚠️', 'Invalid Time Range', 'End time must be after start time');
        return;
    }
    
    const event = {
        id: Date.now(),
        title: title,
        start: startDate,
        end: endDate,
        location: location,
        description: description
    };
    
    events.push(event);
    updateEventsList();
    renderCalendar();
    
    // Clear form
    document.getElementById('event-title').value = '';
    document.getElementById('event-start').value = '';
    document.getElementById('event-end').value = '';
    document.getElementById('event-location').value = '';
    document.getElementById('event-description').value = '';
    
    toggleAddEvent();
    showCustomAlert('✅', 'Success!', 'Event added successfully');
}

// Custom alert dialog
function showCustomAlert(emoji, title, message) {
    // Remove existing alert if any
    const existingAlert = document.getElementById('custom-alert');
    if (existingAlert) {
        existingAlert.remove();
    }
    
    // Create alert overlay
    const alertOverlay = document.createElement('div');
    alertOverlay.id = 'custom-alert';
    alertOverlay.className = 'custom-alert-overlay';
    
    alertOverlay.innerHTML = `
        <div class="custom-alert-box">
            <div class="custom-alert-emoji">${emoji}</div>
            <h2 class="custom-alert-title">${title}</h2>
            <p class="custom-alert-message">${message}</p>
            <button class="custom-alert-btn" onclick="closeCustomAlert()">Close</button>
        </div>
    `;
    
    document.body.appendChild(alertOverlay);
    
    // Fade in animation
    setTimeout(() => {
        alertOverlay.classList.add('show');
    }, 10);
}

function closeCustomAlert() {
    const alertOverlay = document.getElementById('custom-alert');
    if (alertOverlay) {
        alertOverlay.classList.remove('show');
        setTimeout(() => {
            alertOverlay.remove();
        }, 300);
    }
}

// Update showMessage to use custom alert
function showMessage(message) {
    const emoji = message.includes('✅') ? '✅' : message.includes('🗑️') ? '🗑️' : message.includes('✏️') ? '✏️' : 'ℹ️';
    const title = message.includes('✅') ? 'Success!' : message.includes('🗑️') ? 'Deleted' : message.includes('✏️') ? 'Edit Mode' : 'Notice';
    showCustomAlert(emoji, title, message.replace(/[✅🗑️✏️⚠️]/g, '').trim());
}


// Update events list display
function updateEventsList() {
    const listEl = document.getElementById('events-list');
    const countEl = document.getElementById('event-count');
    const downloadBtn = document.getElementById('download-btn');
    
    countEl.textContent = events.length;
    downloadBtn.disabled = events.length === 0;
    
    if (events.length === 0) {
        listEl.innerHTML = '<p class="empty-state">No events yet. Click "+ Add Event" below! 👇</p>';
        return;
    }
    
    events.sort((a, b) => a.start - b.start);
    
    listEl.innerHTML = events.map(event => {
        const isMultiDay = !isSameDay(event.start, event.end);
        const color = getEventColor(event.id);
        
        return `
        <div class="event-item" style="border-left-color: ${color.border};">
            <div class="event-info">
                <h4>
                    <span class="event-color-dot" style="background: ${color.bg}; border: 2px solid ${color.border};"></span>
                    ${escapeHtml(event.title)} ${isMultiDay ? '📅' : ''}
                </h4>
                <p>📅 ${formatDate(event.start)}${isMultiDay ? ' - ' + formatDate(event.end) : ''}</p>
                <p>⏰ ${formatTime(event.start)} - ${formatTime(event.end)}</p>
                ${event.location ? `<p>📍 ${escapeHtml(event.location)}</p>` : ''}
            </div>
            <div class="event-actions">
                <button class="btn-edit" onclick="editEvent(${event.id})">
                   <img src="images/image2.jpg" alt="Edit" class="icon-btn">Edit
                </button>
                <button class="btn-delete" onclick="deleteEvent(${event.id})">
                    <img src="images/image3.jpg" alt="Delete" class="icon-btn">Delete
                </button>
            </div>
        </div>
    `;
    }).join('');
}

// Delete event function
function deleteEvent(id) {
    if (confirm('Are you sure you want to delete this event?')) {
        events = events.filter(event => event.id !== id);
        updateEventsList();
        renderCalendar();
        showMessage('🗑️ Event deleted');
    }
}

// Edit event function
function editEvent(id) {
    const event = events.find(e => e.id === id);
    if (!event) return;
    
    // Populate form with event data
    document.getElementById('event-title').value = event.title;
    document.getElementById('event-start').value = formatDateTimeLocal(event.start);
    document.getElementById('event-end').value = formatDateTimeLocal(event.end);
    document.getElementById('event-location').value = event.location || '';
    document.getElementById('event-description').value = event.description || '';
    
    // Delete the old event (we'll create a new one with the edits)
    events = events.filter(e => e.id !== id);
    updateEventsList();
    renderCalendar();
    
    // Open the form
    const form = document.getElementById('add-event-form');
    const trigger = document.getElementById('add-trigger');
    form.style.display = 'block';
    trigger.style.display = 'none';
    
    showMessage('✏️ Editing event. Make changes and click "Add Event" to save.');
}

// Helper function to format date for datetime-local input
function formatDateTimeLocal(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// Navigation to specific date
function goToDate(date) {
    currentDate = new Date(date);
    setView('day');
}

function goToMonth(year, month) {
    currentDate = new Date(year, month, 1);
    setView('month');
}

// Calendar Functions
function changeMonth(direction) {
    if (currentView === 'day') {
        currentDate.setDate(currentDate.getDate() + direction);
    } else if (currentView === 'week') {
        currentDate.setDate(currentDate.getDate() + (direction * 7));
    } else if (currentView === 'month') {
        currentDate.setMonth(currentDate.getMonth() + direction);
    } else if (currentView === 'year') {
        currentDate.setFullYear(currentDate.getFullYear() + direction);
    }
    renderCalendar();
}

function setView(view) {
    currentView = view;
    document.getElementById('view-day').classList.toggle('active', view === 'day');
    document.getElementById('view-week').classList.toggle('active', view === 'week');
    document.getElementById('view-month').classList.toggle('active', view === 'month');
    document.getElementById('view-year').classList.toggle('active', view === 'year');
    renderCalendar();
}

function renderCalendar() {
    const container = document.getElementById('calendar-container');
    const monthHeader = document.getElementById('current-month');
    
    if (currentView === 'day') {
        monthHeader.textContent = currentDate.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        });
        renderDayView(container);
    } else if (currentView === 'week') {
        const weekStart = new Date(currentDate);
        weekStart.setDate(currentDate.getDate() - currentDate.getDay());
        monthHeader.textContent = `Week of ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        renderWeekView(container);
    } else if (currentView === 'month') {
        monthHeader.textContent = currentDate.toLocaleDateString('en-US', {
            month: 'long',
            year: 'numeric'
        });
        renderMonthView(container);
    } else if (currentView === 'year') {
        monthHeader.textContent = currentDate.getFullYear().toString();
        renderYearView(container);
    }
}

function renderDayView(container) {
    const dayEvents = events.filter(event => {
        return eventSpansDay(event, currentDate);
    });
    
    let html = '<div class="calendar-day-view">';
    html += `<div class="day-view-header">${currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div>`;
    
    // Time grid (24 hours)
    html += '<div class="day-view-timeline">';
    
    for (let hour = 0; hour < 24; hour++) {
        const hourStr = hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`;
        html += `<div class="timeline-hour">
            <div class="timeline-label">${hourStr}</div>
            <div class="timeline-slot"></div>
        </div>`;
    }
    
    html += '</div>';
    
    // Overlay events on timeline
    if (dayEvents.length > 0) {
        const eventLayout = calculateEventLayout(dayEvents, currentDate);
        
        html += '<div class="day-view-events-overlay">';
        eventLayout.forEach(layoutEvent => {
            const event = layoutEvent.event;
            const column = layoutEvent.column;
            const totalColumns = layoutEvent.totalColumns;
            const color = getEventColor(event.id);
            
            const eventStart = new Date(event.start);
            const eventEnd = new Date(event.end);
            
            let startHour = eventStart.getHours();
            let startMinute = eventStart.getMinutes();
            let endHour = eventEnd.getHours();
            let endMinute = eventEnd.getMinutes();
            
            if (eventStart.toDateString() !== currentDate.toDateString()) {
                startHour = 0;
                startMinute = 0;
            }
            
            if (eventEnd.toDateString() !== currentDate.toDateString()) {
                endHour = 23;
                endMinute = 59;
            }
            
            const topPercent = ((startHour * 60 + startMinute) / (24 * 60)) * 100;
            const durationMinutes = (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
            const heightPercent = (durationMinutes / (24 * 60)) * 100;
            
            const widthPercent = (100 / totalColumns) - 1;
            const leftPercent = (column / totalColumns) * 100;
            
            html += `
                <div class="day-event-overlay" style="
                    top: ${topPercent}%; 
                    height: ${heightPercent}%; 
                    left: ${leftPercent}%;
                    width: ${widthPercent}%;
                    background: ${color.bg};
                    border-left-color: ${color.border};
                ">
                    <strong>${escapeHtml(event.title)}</strong><br>
                    <span>${formatTime(eventStart)} - ${formatTime(eventEnd)}</span>
                    ${event.location ? `<br><span>📍 ${escapeHtml(event.location)}</span>` : ''}
                </div>
            `;
        });
        html += '</div>';
    }
    
    html += '</div>';
    container.innerHTML = html;
}

// Helper function to calculate event layout (columns for overlapping events)
function calculateEventLayout(dayEvents, currentDate) {
    const sortedEvents = [...dayEvents].sort((a, b) => a.start - b.start);
    const columns = [];
    const eventLayout = [];
    
    sortedEvents.forEach(event => {
        const eventStart = new Date(event.start);
        const eventEnd = new Date(event.end);
        
        let column = 0;
        let foundColumn = false;
        
        while (!foundColumn) {
            if (!columns[column]) {
                columns[column] = [];
            }
            
            const isColumnFree = columns[column].every(existingEvent => {
                return existingEvent.end <= eventStart || existingEvent.start >= eventEnd;
            });
            
            if (isColumnFree) {
                columns[column].push(event);
                foundColumn = true;
            } else {
                column++;
            }
        }
        
        eventLayout.push({
            event: event,
            column: column,
            totalColumns: 0
        });
    });
    
    const totalColumns = columns.length;
    eventLayout.forEach(layout => {
        layout.totalColumns = totalColumns;
    });
    
    return eventLayout;
}

function renderWeekView(container) {
    const weekStart = new Date(currentDate);
    weekStart.setDate(currentDate.getDate() - currentDate.getDay());
    
    let html = '<div class="calendar-week">';
    
    for (let i = 0; i < 7; i++) {
        const date = new Date(weekStart);
        date.setDate(date.getDate() + i);
        
        const dayEvents = events.filter(event => {
            return eventSpansDay(event, date);
        });
        
        html += `
            <div class="week-day" onclick="goToDate(new Date(${date.getFullYear()}, ${date.getMonth()}, ${date.getDate()}))">
                <div class="week-day-header">
                    ${date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                </div>
                <div class="week-events">
                    ${dayEvents.length === 0 ? '<span style="color: #999;">No events</span>' : ''}
                    ${dayEvents.map(event => {
                        const color = getEventColor(event.id);
                        return `
                            <div class="week-event-item" style="background: ${color.bg}; border-left: 3px solid ${color.border};">
                                ${formatTime(event.start)} - ${escapeHtml(event.title)}
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }
    
    html += '</div>';
    container.innerHTML = html;
}

function renderMonthView(container) {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - startDate.getDay());
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let html = '<div class="calendar-month">';
    
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    days.forEach(day => {
        html += `<div class="calendar-day-header">${day}</div>`;
    });
    
    const currentMonth = currentDate.getMonth();
    for (let i = 0; i < 42; i++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + i);
        
        const isToday = date.getTime() === today.getTime();
        const isOtherMonth = date.getMonth() !== currentMonth;
        
        const dayEvents = events.filter(event => {
            return eventSpansDay(event, date);
        });
        
        let classes = 'calendar-day';
        if (isToday) classes += ' today';
        if (isOtherMonth) classes += ' other-month';
        
        html += `<div class="${classes}" onclick="goToDate(new Date(${date.getFullYear()}, ${date.getMonth()}, ${date.getDate()}))">`;
        html += `<div class="calendar-day-number">${date.getDate()}</div>`;
        
        if (dayEvents.length > 0) {
            html += '<div class="calendar-day-events">';
            
            // Show only first event title
            const firstEvent = dayEvents[0];
            const isMultiDay = !isSameDay(firstEvent.start, firstEvent.end);
            const isFirstDay = isSameDay(firstEvent.start, date);
            const isLastDay = isSameDay(firstEvent.end, date);
            
            let chipClass = 'calendar-event-chip';
            if (isMultiDay) {
                if (isFirstDay) chipClass += ' multi-day-start';
                else if (isLastDay) chipClass += ' multi-day-end';
                else chipClass += ' multi-day-middle';
            }
            
            html += `<div class="${chipClass}">${escapeHtml(firstEvent.title)}</div>`;
            
            // Show "..." if more than 1 event
            if (dayEvents.length > 1) {
                html += `<div class="calendar-event-more">...</div>`;
            }
            
            html += '</div>';
        }
        
        html += '</div>';
    }
    
    html += '</div>';
    container.innerHTML = html;
}


function renderYearView(container) {
    const year = currentDate.getFullYear();
    let html = '<div class="calendar-year">';
    
    for (let m = 0; m < 12; m++) {
        const monthDate = new Date(year, m, 1);
        const monthName = monthDate.toLocaleDateString('en-US', { month: 'short' });
        
        html += '<div class="year-month">';
        html += `<div class="year-month-name" onclick="goToMonth(${year}, ${m})">${monthName}</div>`;
        html += '<div class="year-month-grid">';
        
        const firstDay = new Date(year, m, 1);
        const lastDay = new Date(year, m + 1, 0);
        const startDay = firstDay.getDay();
        
        for (let i = 0; i < startDay; i++) {
            html += '<div class="year-day"></div>';
        }
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        for (let d = 1; d <= lastDay.getDate(); d++) {
            const date = new Date(year, m, d);
            date.setHours(0, 0, 0, 0);
            
            const isToday = date.getTime() === today.getTime();
            const hasEvents = events.some(event => {
                return eventSpansDay(event, date);
            });
            
            let classes = 'year-day';
            if (isToday) classes += ' today';
            if (hasEvents) classes += ' has-events';
            
            html += `<div class="${classes}" onclick="goToDate(new Date(${year}, ${m}, ${d}))">${d}</div>`;
        }
        
        html += '</div></div>';
    }
    
    html += '</div>';
    container.innerHTML = html;
}

// Helper function to check if an event spans a specific day
function eventSpansDay(event, date) {
    const eventStart = new Date(event.start);
    const eventEnd = new Date(event.end);
    const checkDate = new Date(date);
    
    eventStart.setHours(0, 0, 0, 0);
    eventEnd.setHours(23, 59, 59, 999);
    checkDate.setHours(0, 0, 0, 0);
    
    return checkDate >= eventStart && checkDate <= eventEnd;
}

// Helper function to check if two dates are the same day
function isSameDay(date1, date2) {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate();
}

// Utility functions
function formatDate(date) {
    return date.toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function formatTime(date) {
    return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showMessage(message) {
    alert(message);
}

// Download calendar function
function downloadCalendar() {
    if (events.length === 0) {
        alert('⚠️ No events to download');
        return;
    }
    
    const icsContent = generateICS(events);
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `my-calendar-${Date.now()}.ics`;
    link.click();
    
    showMessage('✅ Calendar downloaded! You can now import it into Google Calendar, Outlook, or Apple Calendar.');
}
