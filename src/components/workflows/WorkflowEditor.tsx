// ---------------------------------------------------------------------------
// OpenBrowserClaw — Workflow Editor
// ---------------------------------------------------------------------------

import { useState, useEffect } from 'react';
import { Save, X, Plus, Trash2, MoveUp, MoveDown, Bot } from 'lucide-react';
import type { BotWorkflow, WorkflowStep, BotConfig } from '../../types.js';
import { getAllBots } from '../../db.js';
import { ulid } from '../../ulid.js';

interface Props {
  workflow: BotWorkflow;
  isNew: boolean;
  onSave: (workflow: BotWorkflow) => void;
  onCancel: () => void;
}

export function WorkflowEditor({ workflow: initialWorkflow, isNew, onSave, onCancel }: Props) {
  const [workflow, setWorkflow] = useState<BotWorkflow>(initialWorkflow);
  const [availableBots, setAvailableBots] = useState<BotConfig[]>([]);

  useEffect(() => {
    loadBots();
  }, []);

  async function loadBots() {
    try {
      const bots = await getAllBots();
      setAvailableBots(bots.filter((b) => b.enabled));
    } catch (err) {
      console.error('Failed to load bots:', err);
    }
  }

  function handleChange(field: keyof BotWorkflow, value: any) {
    setWorkflow((prev) => ({ ...prev, [field]: value, updatedAt: Date.now() }));
  }

  function handleAddStep() {
    const newStep: WorkflowStep = {
      id: ulid(),
      botId: availableBots[0]?.id || '',
      order: workflow.steps.length,
      prompt: '',
      transformOutput: false,
    };
    handleChange('steps', [...workflow.steps, newStep]);
  }

  function handleUpdateStep(stepId: string, updates: Partial<WorkflowStep>) {
    const updatedSteps = workflow.steps.map((step) =>
      step.id === stepId ? { ...step, ...updates } : step
    );
    handleChange('steps', updatedSteps);
  }

  function handleRemoveStep(stepId: string) {
    const updatedSteps = workflow.steps
      .filter((step) => step.id !== stepId)
      .map((step, index) => ({ ...step, order: index }));
    handleChange('steps', updatedSteps);
  }

  function handleMoveStep(stepId: string, direction: 'up' | 'down') {
    const index = workflow.steps.findIndex((s) => s.id === stepId);
    if (index === -1) return;
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === workflow.steps.length - 1) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    const updatedSteps = [...workflow.steps];
    [updatedSteps[index], updatedSteps[newIndex]] = [updatedSteps[newIndex], updatedSteps[index]];
    
    // Update order numbers
    updatedSteps.forEach((step, i) => {
      step.order = i;
    });

    handleChange('steps', updatedSteps);
  }

  function getBotName(botId: string): string {
    return availableBots.find((b) => b.id === botId)?.name || 'Unknown Bot';
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (workflow.steps.length === 0) {
      alert('Please add at least one step to the workflow');
      return;
    }
    onSave(workflow);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-base-300 flex items-center justify-between">
        <h1 className="text-xl font-bold">{isNew ? 'Create Workflow' : 'Edit Workflow'}</h1>
        <button className="btn btn-ghost btn-sm btn-circle" onClick={onCancel}>
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Basic Info */}
        <div className="card bg-base-200">
          <div className="card-body">
            <h2 className="card-title text-lg">Basic Information</h2>

            <div className="form-control">
              <label className="label">
                <span className="label-text">Workflow Name</span>
              </label>
              <input
                type="text"
                className="input input-bordered"
                value={workflow.name}
                onChange={(e) => handleChange('name', e.target.value)}
                placeholder="My Workflow"
                required
              />
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text">Description</span>
              </label>
              <textarea
                className="textarea textarea-bordered"
                rows={3}
                value={workflow.description}
                onChange={(e) => handleChange('description', e.target.value)}
                placeholder="Describe what this workflow does..."
              />
            </div>
          </div>
        </div>

        {/* Workflow Steps */}
        <div className="card bg-base-200">
          <div className="card-body">
            <div className="flex items-center justify-between">
              <h2 className="card-title text-lg">Workflow Steps</h2>
              <button
                type="button"
                className="btn btn-sm btn-primary gap-2"
                onClick={handleAddStep}
                disabled={availableBots.length === 0}
              >
                <Plus className="w-4 h-4" />
                Add Step
              </button>
            </div>

            <p className="text-sm opacity-60">
              Each step runs a bot. The output from one step becomes the input to the next.
            </p>

            {availableBots.length === 0 ? (
              <div className="alert alert-warning">
                <span>No enabled bots available. Create and enable bots first.</span>
              </div>
            ) : workflow.steps.length === 0 ? (
              <div className="text-center py-6 opacity-60">
                <Bot className="w-8 h-8 mx-auto mb-2" />
                <p className="text-sm">No steps yet. Add your first step above.</p>
              </div>
            ) : (
              <div className="space-y-3 mt-4">
                {workflow.steps.map((step, index) => (
                  <div key={step.id} className="card bg-base-300">
                    <div className="card-body p-4">
                      <div className="flex items-center gap-3">
                        <div className="badge badge-lg badge-primary">
                          Step {index + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <select
                            className="select select-bordered select-sm w-full"
                            value={step.botId}
                            onChange={(e) => handleUpdateStep(step.id, { botId: e.target.value })}
                          >
                            {availableBots.map((bot) => (
                              <option key={bot.id} value={bot.id}>
                                {bot.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs btn-circle"
                            onClick={() => handleMoveStep(step.id, 'up')}
                            disabled={index === 0}
                            title="Move up"
                          >
                            <MoveUp className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs btn-circle"
                            onClick={() => handleMoveStep(step.id, 'down')}
                            disabled={index === workflow.steps.length - 1}
                            title="Move down"
                          >
                            <MoveDown className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs btn-circle text-error"
                            onClick={() => handleRemoveStep(step.id)}
                            title="Remove step"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="form-control mt-2">
                        <label className="label">
                          <span className="label-text text-xs">
                            Custom Prompt Template (optional)
                          </span>
                        </label>
                        <textarea
                          className="textarea textarea-bordered textarea-sm"
                          rows={2}
                          value={step.prompt || ''}
                          onChange={(e) => handleUpdateStep(step.id, { prompt: e.target.value })}
                          placeholder="Use {input} to reference previous output. Leave empty to pass output directly."
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary gap-2">
            <Save className="w-4 h-4" />
            {isNew ? 'Create Workflow' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
