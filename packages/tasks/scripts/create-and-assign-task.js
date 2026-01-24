import pkg from 'level';
const { Level } = pkg;

async function createDevelopmentTask() {
  try {
    console.log('🎯 Creating high-priority development task...');
    
    // Open task database
    const db = new Level('./db/tasks', { valueEncoding: 'json' });
    
    // Create high-priority task
    const taskId = 'dev-' + Date.now();
    const task = {
      title: "Task Priority Management Implementation",
      description: "As a team lead, implement drag-and-drop task reordering, priority levels with visual indicators, bulk priority assignment, and priority change notifications to help the team work on most important items first.",
      status: "in-progress",
      priority: "high",
      type: "task",
      assignedTo: "development",
      createdBy: "system",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      handoffTime: new Date().toISOString(),
      handoffNotes: "Highest priority task handed off to development for immediate implementation",
      dependencies: [],
      acceptanceCriteria: [
        "Drag-and-drop task reordering functionality",
        "Visual priority level indicators",
        "Bulk priority assignment capability", 
        "Priority change notification system"
      ]
    };
    
    await db.put(taskId, task);
    await db.close();
    
    console.log('\n🎉 TASK HANDOFF COMPLETE! 🎉');
    console.log('=====================================');
    console.log('✅ High-priority task successfully created and assigned to development!');
    console.log('');
    console.log('🚀 TASK DETAILS:');
    console.log('   Title:', task.title);
    console.log('   ID:', taskId);
    console.log('   Status:', task.status);
    console.log('   Priority:', task.priority);
    console.log('   Assigned to:', task.assignedTo);
    console.log('   Handoff time:', task.handoffTime);
    console.log('');
    console.log('📋 ACCEPTANCE CRITERIA:');
    task.acceptanceCriteria.forEach((criteria, index) => {
      console.log(`   ${index + 1}. ${criteria}`);
    });
    console.log('');
    console.log('🎯 Development team can now begin implementation!');
    console.log('=====================================');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

createDevelopmentTask();