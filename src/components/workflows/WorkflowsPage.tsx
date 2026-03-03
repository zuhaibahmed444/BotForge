
import { useEffect, useState } from 'react';
import { Workflow, Plus, Play, Edit, Trash2, Copy, Power, PowerOff, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router';
import type { BotWorkflow } from '../../types.js';
import { getAllWorkflows, saveWorkflow, deleteWorkflow, resetDatabase } from '../../db.js';
import { ulid } from '../../ulid.js';
import { WorkflowEditor } from './WorkflowEditor';

export function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<BotWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingWorkflow, setEditingWorkflow] = useState<BotWorkflow | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [needsUpgrade, setNeedsUpgrade] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    loadWorkflows();
  }, []);

  async function loadWorkflows() {
    setLoading(true);
    try {
      const allWorkflows = await getAllWorkflows();
      setWorkflows(allWorkflows);
      setNeedsUpgrade(false);
    } catch (err) {
      console.error('Failed to load workflows:', err);
      // Check if it's a database upgrade issue
      if (err instanceof Error && err.message.includes('object stores was not found')) {
        setNeedsUpgrade(true);
      }
    } finally {
      setLoading(false);
    }
  }

  function handleCreateNew() {
    setCreatingNew(true);
    setEditingWorkflow({
      id: ulid(),
      name: 'New Workflow',
      description: '',
      steps: [],
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  async function handleSave(workflow: BotWorkflow) {
    try {
      await saveWorkflow(workflow);
      setEditingWorkflow(null);
      setCreatingNew(false);
      loadWorkflows();
    } catch (err) {
      console.error('Failed to save workflow:', err);
      if (err instanceof Error && err.message.includes('object stores was not found')) {
        setNeedsUpgrade(true);
        setEditingWorkflow(null);
        setCreatingNew(false);
      } else {
        const errorMessage = err instanceof Error ? err.message : String(err);
        alert(`Failed to save workflow: ${errorMessage}`);
      }
    }
  }

  async function handleUpgradeDatabase() {
    if (!confirm('This will reset the database and reload the page. Your data will be preserved. Continue?')) {
      return;
    }
    try {
      await resetDatabase();
      window.location.reload();
    } catch (err) {
      console.error('Failed to reset database:', err);
      alert('Failed to reset database. Please close all tabs and try again.');
    }
  }

  async function handleToggleEnabled(workflow: BotWorkflow) {
    try {
      await saveWorkflow({ ...workflow, enabled: !workflow.enabled, updatedAt: Date.now() });
      loadWorkflows();
    } catch (err) {
      console.error('Failed to toggle workflow:', err);
    }
  }

  async function handleDuplicate(workflow: BotWorkflow) {
    const newWorkflow: BotWorkflow = {
      ...workflow,
      id: ulid(),
      name: `${workflow.name} (Copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    try {
      await saveWorkflow(newWorkflow);
      loadWorkflows();
    } catch (err) {
      console.error('Failed to duplicate workflow:', err);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteWorkflow(id);
      setDeleteConfirm(null);
      loadWorkflows();
    } catch (err) {
      console.error('Failed to delete workflow:', err);
    }
  }

  function handleExecute(workflow: BotWorkflow) {
    // Navigate to chat with workflow ID
    navigate(`/chat?workflow=${workflow.id}`);
  }

  if (editingWorkflow) {
    return (
      <WorkflowEditor
        workflow={editingWorkflow}
        isNew={creatingNew}
        onSave={handleSave}
        onCancel={() => {
          setEditingWorkflow(null);
          setCreatingNew(false);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-base-300 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Bot Workflows</h1>
          <p className="text-sm opacity-60">Chain multiple bots together for complex tasks</p>
        </div>
        <button className="btn btn-primary gap-2" onClick={handleCreateNew}>
          <Plus className="w-4 h-4" />
          New Workflow
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {needsUpgrade ? (
          <div className="hero py-12">
            <div className="hero-content text-center">
              <div className="max-w-md">
                <RefreshCw className="w-12 h-12 mx-auto mb-4 text-warning" />
                <h2 className="text-2xl font-bold">Database Upgrade Required</h2>
                <p className="mt-2 opacity-60 mb-6">
                  The workflows feature requires a database upgrade. Click below to upgrade.
                </p>
                <button className="btn btn-primary gap-2" onClick={handleUpgradeDatabase}>
                  <RefreshCw className="w-4 h-4" />
                  Upgrade Database
                </button>
                <p className="text-xs opacity-40 mt-4">
                  This will reload the page. Your data will be preserved.
                </p>
              </div>
            </div>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-12">
            <span className="loading loading-spinner loading-md" />
          </div>
        ) : workflows.length === 0 ? (
          <div className="hero py-12">
            <div className="hero-content text-center">
              <div>
                <Workflow className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <h2 className="text-2xl font-bold">No workflows yet</h2>
                <p className="mt-2 opacity-60 mb-6">
                  Create workflows to chain multiple bots together
                </p>
                <button className="btn btn-primary gap-2" onClick={handleCreateNew}>
                  <Plus className="w-4 h-4" />
                  Create Your First Workflow
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {workflows.map((workflow) => (
              <div
                key={workflow.id}
                className={`card bg-base-200 shadow-sm ${
                  !workflow.enabled ? 'opacity-60' : ''
                }`}
              >
                <div className="card-body p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Workflow className="w-5 h-5 shrink-0" />
                      <h3 className="font-bold truncate">{workflow.name}</h3>
                    </div>
                    <button
                      className={`btn btn-ghost btn-xs btn-circle ${
                        workflow.enabled ? 'text-success' : 'text-error'
                      }`}
                      onClick={() => handleToggleEnabled(workflow)}
                      title={workflow.enabled ? 'Disable' : 'Enable'}
                    >
                      {workflow.enabled ? (
                        <Power className="w-4 h-4" />
                      ) : (
                        <PowerOff className="w-4 h-4" />
                      )}
                    </button>
                  </div>

                  {workflow.description && (
                    <p className="text-sm opacity-70 line-clamp-2">{workflow.description}</p>
                  )}

                  <div className="flex flex-wrap gap-1 mt-2">
                    <div className="badge badge-sm badge-primary">
                      {workflow.steps.length} steps
                    </div>
                  </div>

                  {/* Primary Execute Button */}
                  <button
                    className="btn btn-primary btn-sm w-full gap-2 mt-3"
                    onClick={() => handleExecute(workflow)}
                    disabled={!workflow.enabled || workflow.steps.length === 0}
                  >
                    <Play className="w-4 h-4" />
                    Execute Workflow
                  </button>

                  <div className="card-actions justify-end mt-2">
                    <button
                      className="btn btn-ghost btn-xs gap-1"
                      onClick={() => setEditingWorkflow(workflow)}
                    >
                      <Edit className="w-3 h-3" />
                      Edit
                    </button>
                    <button
                      className="btn btn-ghost btn-xs gap-1"
                      onClick={() => handleDuplicate(workflow)}
                    >
                      <Copy className="w-3 h-3" />
                      Duplicate
                    </button>
                    <button
                      className="btn btn-ghost btn-xs gap-1 text-error"
                      onClick={() => setDeleteConfirm(workflow.id)}
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      {deleteConfirm && (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-sm">
            <h3 className="font-bold text-lg">Delete Workflow?</h3>
            <p className="py-4">
              Are you sure you want to delete this workflow? This action cannot be undone.
            </p>
            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => setDeleteConfirm(null)}>
                Cancel
              </button>
              <button
                className="btn btn-error"
                onClick={() => handleDelete(deleteConfirm)}
              >
                Delete
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={() => setDeleteConfirm(null)}>close</button>
          </form>
        </dialog>
      )}
    </div>
  );
}
