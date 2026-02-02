// Enhanced Audit History Loading
async function loadAuditHistory() {
    try {
        const taskId = document.getElementById('historyTaskId').value;
        const eventType = document.getElementById('historyEventType').value;
        const changedBy = document.getElementById('historyChangedBy').value;
        const fromDate = document.getElementById('historyFromDate').value;
        const toDate = document.getElementById('historyToDate').value;
        const limit = parseInt(document.getElementById('historyLimit').value);
        
        const params = new URLSearchParams();
        if (taskId) params.append('taskId', taskId);
        if (eventType) params.append('eventType', eventType);
        if (changedBy) params.append('changedBy', changedBy);
        if (limit) params.append('limit', limit.toString());
        if (fromDate) params.append('fromDate', fromDate);
        if (toDate) params.append('toDate', toDate);
        
        const response = await fetch('/api/audit/history?' + params.toString());
        const events = await response.json();
        
        displayAuditHistory(events);
        
        // Load task summary if specific task ID
        if (taskId) {
            loadTaskSummary(taskId);
        } else {
            document.getElementById('taskSummarySection').style.display = 'none';
        }
    } catch (error) {
        console.error('Error loading audit history:', error);
        showError('Failed to load audit history');
    }
}

async function loadTaskSummary(taskId) {
    try {
        const response = await fetch('/api/audit/summary?taskId=' + taskId);
        const summary = await response.json();
        
        if (summary) {
            displayTaskSummary(summary);
            document.getElementById('taskSummarySection').style.display = 'block';
        } else {
            document.getElementById('taskSummarySection').style.display = 'none';
        }
    } catch (error) {
        console.error('Error loading task summary:', error);
    }
}

async function loadAuditStatistics() {
    try {
        const response = await fetch('/api/audit/statistics');
        const stats = await response.json();
        
        displayAuditStatistics(stats);
    } catch (error) {
        console.error('Error loading audit statistics:', error);
        showError('Failed to load audit statistics');
    }
}

function displayAuditHistory(events) {
    const container = document.getElementById('auditHistoryList');
    
    if (!events || events.length === 0) {
        container.innerHTML = '<div class="loading">No audit events found</div>';
        return;
    }
    
    const html = events.map(event => {
        const eventDate = new Date(event.timestamp);
        const formattedTime = eventDate.toLocaleString();
        const relativeTime = getRelativeTime(eventDate);
        
        let eventIcon = '📝';
        let eventColor = '#6b7280';
        
        switch (event.eventType) {
            case 'created':
                eventIcon = '✨';
                eventColor = '#10b981';
                break;
            case 'status_changed':
                eventIcon = '🔄';
                eventColor = '#3b82f6';
                break;
            case 'priority_changed':
                eventIcon = '⚡';
                eventColor = '#f59e0b';
                break;
            case 'assigned':
                eventIcon = '👤';
                eventColor = '#8b5cf6';
                break;
            case 'updated':
                eventIcon = '✏️';
                eventColor = '#6b7280';
                break;
            case 'deleted':
                eventIcon = '🗑️';
                eventColor = '#ef4444';
                break;
            case 'dependency_added':
                eventIcon = '🔗';
                eventColor = '#06b6d4';
                break;
            case 'dependency_removed':
                eventIcon = '⛓️';
                eventColor = '#dc2626';
                break;
        }
        
        let eventDetails = '';
        if (event.eventType === 'status_changed') {
            eventDetails = '<div class="event-details">' +
                'Status: <span class="status ' + (event.oldStatus || 'unknown') + '">' + (event.oldStatus || 'unknown') + '</span> ' +
                '→ <span class="status ' + event.newStatus + '">' + event.newStatus + '</span>' +
                (event.duration ? ' (' + Math.round(event.duration / 1000) + 's)' : '') +
                '</div>';
        } else if (event.eventType === 'priority_changed') {
            eventDetails = '<div class="event-details">' +
                'Priority: <span class="priority ' + (event.oldPriority || 'medium') + '">' + (event.oldPriority || 'medium') + '</span> ' +
                '→ <span class="priority ' + event.newPriority + '">' + event.newPriority + '</span>' +
                '</div>';
        } else if (event.eventType === 'assigned') {
            eventDetails = '<div class="event-details">' +
                'Assigned to: <strong>' + (event.assignedTo || 'Unassigned') + '</strong>' +
                (event.assignedBy ? ' by ' + event.assignedBy : '') +
                '</div>';
        }
        
        return '<div class="audit-event">' +
            '<div class="event-header">' +
                '<span class="event-icon" style="color: ' + eventColor + ';">' + eventIcon + '</span>' +
                '<span class="event-type">' + event.eventType.replace(/_/g, ' ').toUpperCase() + '</span>' +
                '<span class="event-time" title="' + formattedTime + '">' + relativeTime + '</span>' +
            '</div>' +
            '<div class="event-content">' +
                '<div class="event-task">Task ID: <strong>' + event.taskId + '</strong></div>' +
                eventDetails +
                (event.changedBy ? '<div class="event-changed-by">Changed by: ' + event.changedBy + '</div>' : '') +
                (event.errorMessage ? '<div class="event-error">Error: ' + event.errorMessage + '</div>' : '') +
            '</div>' +
            '</div>';
    }).join('');
    
    container.innerHTML = html;
}

function displayTaskSummary(summary) {
    const container = document.getElementById('taskSummaryContent');
    
    const completionRate = summary.statusTransitions > 0 
        ? Math.round((1 - (summary.failureCount / summary.statusTransitions)) * 100)
        : 100;
    
    const html = '<div class="summary-grid">' +
        '<div class="summary-item">' +
            '<div class="summary-label">Current Status</div>' +
            '<div class="summary-value"><span class="status ' + summary.currentStatus + '">' + summary.currentStatus.toUpperCase() + '</span></div>' +
        '</div>' +
        '<div class="summary-item">' +
            '<div class="summary-label">Total Events</div>' +
            '<div class="summary-value">' + summary.totalEvents + '</div>' +
        '</div>' +
        '<div class="summary-item">' +
            '<div class="summary-label">Status Changes</div>' +
            '<div class="summary-value">' + summary.statusTransitions + '</div>' +
        '</div>' +
        '<div class="summary-item">' +
            '<div class="summary-label">Success Rate</div>' +
            '<div class="summary-value">' + completionRate + '%</div>' +
        '</div>' +
        '<div class="summary-item">' +
            '<div class="summary-label">Total Duration</div>' +
            '<div class="summary-value">' + formatDuration(summary.totalDuration) + '</div>' +
        '</div>' +
        '<div class="summary-item">' +
            '<div class="summary-label">Retries</div>' +
            '<div class="summary-value">' + summary.retryCount + '</div>' +
        '</div>' +
        '</div>' +
        '<div class="summary-timeline">' +
            '<div>First Event: ' + summary.firstEvent.toLocaleString() + '</div>' +
            '<div>Last Event: ' + summary.lastEvent.toLocaleString() + '</div>' +
        '</div>';
    
    container.innerHTML = html;
}

function displayAuditStatistics(stats) {
    // Create modal to show statistics
    const modal = document.getElementById('taskModal');
    const modalContent = document.getElementById('modalTaskContent');
    
    const eventsByTypeHtml = Object.entries(stats.eventsByType).map(([type, count]) => 
        '<div class="event-type-stat">' +
            '<span class="event-type-name">' + type.replace(/_/g, ' ').toUpperCase() + '</span>' +
            '<span class="event-type-count">' + count + '</span>' +
        '</div>'
    ).join('');
    
    const mostActiveTasksHtml = stats.mostActiveTasks.map(task => 
        '<div class="active-task">' +
            '<span class="task-id">' + task.taskId + '</span>' +
            '<span class="event-count">' + task.eventCount + ' events</span>' +
        '</div>'
    ).join('');
    
    const html = '<h3>Audit Statistics</h3>' +
        '<div class="stats-grid">' +
            '<div class="stat-item">' +
                '<div class="stat-label">Total Events</div>' +
                '<div class="stat-value">' + stats.totalEvents.toLocaleString() + '</div>' +
            '</div>' +
            '<div class="stat-item">' +
                '<div class="stat-label">Failure Rate</div>' +
                '<div class="stat-value">' + stats.failureRate.toFixed(2) + '%</div>' +
            '</div>' +
            '<div class="stat-item">' +
                '<div class="stat-label">Avg Completion Time</div>' +
                '<div class="stat-value">' + formatDuration(stats.averageCompletionTime) + '</div>' +
            '</div>' +
        '</div>' +
        '<h4>Events by Type</h4>' +
        '<div class="events-by-type">' + eventsByTypeHtml + '</div>' +
        '<h4>Most Active Tasks</h4>' +
        '<div class="most-active-tasks">' + mostActiveTasksHtml + '</div>';
    
    modalContent.innerHTML = html;
    modal.classList.add('show');
}

function applyHistoryFilters() {
    loadAuditHistory();
}

function clearHistoryFilters() {
    document.getElementById('historyTaskId').value = '';
    document.getElementById('historyEventType').value = '';
    document.getElementById('historyChangedBy').value = '';
    document.getElementById('historyFromDate').value = '';
    document.getElementById('historyToDate').value = '';
    document.getElementById('historyLimit').value = '100';
    loadAuditHistory();
}

function formatDuration(ms) {
    if (!ms || ms === 0) return 'N/A';
    
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return days + 'd ' + (hours % 24) + 'h';
    if (hours > 0) return hours + 'h ' + (minutes % 60) + 'm';
    if (minutes > 0) return minutes + 'm ' + (seconds % 60) + 's';
    return seconds + 's';
}