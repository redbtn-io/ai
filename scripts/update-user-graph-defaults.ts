/**
 * Update User Graph Defaults
 * 
 * Phase 1: Dynamic Graph System
 * Sets defaultGraphId='red-graph-default' for all existing users.
 * This is a one-time migration script.
 */

import mongoose from 'mongoose';

async function updateUserGraphDefaults() {
  try {
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/redbtn';
    
    console.log('[UpdateUsers] Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('[UpdateUsers] Connected successfully');
    
    // Get users collection from webapp database
    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');
    
    // Count users before update
    const totalUsers = await usersCollection.countDocuments({});
    console.log(`[UpdateUsers] Found ${totalUsers} users in database`);
    
    // Update all users to have defaultGraphId
    console.log('[UpdateUsers] Setting defaultGraphId for all users...');
    const result = await usersCollection.updateMany(
      {}, // Match all users
      { 
        $set: { 
          defaultGraphId: 'red-graph-default'
        } 
      }
    );
    
    console.log(`[UpdateUsers] ✓ Updated ${result.modifiedCount} users with defaultGraphId='red-graph-default'`);
    console.log(`[UpdateUsers] (${totalUsers - result.modifiedCount} users already had the field set)`);
    
    console.log('[UpdateUsers] Disconnecting from MongoDB...');
    await mongoose.disconnect();
    console.log('[UpdateUsers] Done!');
    
    process.exit(0);
  } catch (error) {
    console.error('[UpdateUsers] Error updating users:', error);
    process.exit(1);
  }
}

// Run the update function
updateUserGraphDefaults();
