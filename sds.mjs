/**
 * Base configuration application for advancements that can be extended by other types to implement custom
 * editing interfaces.
 *
 * @param {Advancement} advancement            The advancement item being edited.
 * @param {object} [options={}]                Additional options passed to FormApplication.
 * @param {string} [options.dropKeyPath=null]  Path within advancement configuration where dropped items are stored.
 *                                             If populated, will enable default drop & delete behavior.
 */
class AdvancementConfig extends FormApplication {
  constructor(advancement, options = {}) {
    super(advancement, options);
    this.#advancementId = advancement.id;
    this.item = advancement.item;
  }

  /* -------------------------------------------- */

  /**
   * The ID of the advancement being created or edited.
   * @type {string}
   */
  #advancementId;

  /* -------------------------------------------- */

  /**
   * Parent item to which this advancement belongs.
   * @type {Item5e}
   */
  item;

  /* -------------------------------------------- */

  /** @inheritDoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["sds", "advancement", "dialog"],
      template: "systems/sds/templates/advancement/advancement-config.hbs",
      width: 400,
      height: "auto",
      submitOnChange: true,
      closeOnSubmit: false,
      dropKeyPath: null,
    });
  }

  /* -------------------------------------------- */

  /**
   * The advancement being created or edited.
   * @type {Advancement}
   */
  get advancement() {
    return this.item.advancement.byId[this.#advancementId];
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  get title() {
    const type = this.advancement.constructor.metadata.title;
    return `${game.i18n.format("SdS.AdvancementConfigureTitle", {
      item: this.item.name,
    })}: ${type}`;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async close(options = {}) {
    await super.close(options);
    delete this.advancement.apps[this.appId];
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  getData() {
    const levels = Object.fromEntries(
      Array.fromRange(CONFIG.SdS.maxLevel + 1).map((l) => [l, l])
    );
    if (["class", "subclass"].includes(this.item.type)) delete levels[0];
    else levels[0] = game.i18n.localize("SdS.AdvancementLevelAnyHeader");
    const context = {
      CONFIG: CONFIG.SdS,
      ...this.advancement.toObject(false),
      src: this.advancement.toObject(),
      default: {
        title: this.advancement.constructor.metadata.title,
        icon: this.advancement.constructor.metadata.icon,
      },
      levels,
      showClassRestrictions: this.item.type === "class",
      showLevelSelector: !this.advancement.constructor.metadata.multiLevel,
    };
    Object.defineProperty(context, "data", {
      get() {
        foundry.utils.logCompatibilityWarning(
          `You are accessing the ${this.constructor.name}#data object which is no longer used. ` +
            "Since 2.1 the Advancement class and its contained DataModel are merged into a combined data structure. " +
            "You should now reference keys which were previously contained within the data object directly.",
          { since: "SdS 2.1", until: "SdS 2.2" }
        );
        return context;
      },
    });
    return context;
  }

  /* -------------------------------------------- */

  /**
   * Perform any changes to configuration data before it is saved to the advancement.
   * @param {object} configuration  Configuration object.
   * @returns {object}              Modified configuration.
   */
  prepareConfigurationUpdate(configuration) {
    return configuration;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  activateListeners(html) {
    super.activateListeners(html);

    // Remove an item from the list
    if (this.options.dropKeyPath)
      html.on("click", "[data-action='delete']", this._onItemDelete.bind(this));
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  render(force = false, options = {}) {
    this.advancement.apps[this.appId] = this;
    return super.render(force, options);
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async _updateObject(event, formData) {
    let updates = foundry.utils.expandObject(formData);
    if (updates.data) {
      foundry.utils.logCompatibilityWarning(
        "An update being performed on an advancement points to `data`. Advancement data has moved to the top level so the" +
          " leading `data.` is no longer required.",
        { since: "SdS 2.1", until: "SdS 2.2" }
      );
      const data = updates.data;
      delete updates.data;
      updates = { ...updates, ...data };
    }
    if (updates.configuration)
      updates.configuration = this.prepareConfigurationUpdate(
        updates.configuration
      );
    await this.advancement.update(updates);
  }

  /* -------------------------------------------- */

  /**
   * Helper method to take an object and apply updates that remove any empty keys.
   * @param {object} object  Object to be cleaned.
   * @returns {object}       Copy of object with only non false-ish values included and others marked
   *                         using `-=` syntax to be removed by update process.
   * @protected
   */
  static _cleanedObject(object) {
    return Object.entries(object).reduce((obj, [key, value]) => {
      if (value) obj[key] = value;
      else obj[`-=${key}`] = null;
      return obj;
    }, {});
  }

  /* -------------------------------------------- */
  /*  Drag & Drop for Item Pools                  */
  /* -------------------------------------------- */

  /**
   * Handle deleting an existing Item entry from the Advancement.
   * @param {Event} event        The originating click event.
   * @returns {Promise<Item5e>}  The updated parent Item after the application re-renders.
   * @protected
   */
  async _onItemDelete(event) {
    event.preventDefault();
    const uuidToDelete =
      event.currentTarget.closest("[data-item-uuid]")?.dataset.itemUuid;
    if (!uuidToDelete) return;
    const items = foundry.utils.getProperty(
      this.advancement.configuration,
      this.options.dropKeyPath
    );
    const updates = {
      configuration: await this.prepareConfigurationUpdate({
        [this.options.dropKeyPath]: items.filter(
          (uuid) => uuid !== uuidToDelete
        ),
      }),
    };
    await this.advancement.update(updates);
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _canDragDrop() {
    return this.isEditable;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async _onDrop(event) {
    if (!this.options.dropKeyPath)
      throw new Error(
        "AdvancementConfig#options.dropKeyPath must be configured or #_onDrop must be overridden to support" +
          " drag and drop on advancement config items."
      );

    // Try to extract the data
    const data = TextEditor.getDragEventData(event);

    if (data?.type !== "Item") return false;
    const item = await Item.implementation.fromDropData(data);

    try {
      this._validateDroppedItem(event, item);
    } catch (err) {
      return ui.notifications.error(err.message);
    }

    const existingItems = foundry.utils.getProperty(
      this.advancement.configuration,
      this.options.dropKeyPath
    );

    // Abort if this uuid is the parent item
    if (item.uuid === this.item.uuid) {
      return ui.notifications.error(
        game.i18n.localize("SdS.AdvancementItemGrantRecursiveWarning")
      );
    }

    // Abort if this uuid exists already
    if (existingItems.includes(item.uuid)) {
      return ui.notifications.warn(
        game.i18n.localize("SdS.AdvancementItemGrantDuplicateWarning")
      );
    }

    await this.advancement.update({
      [`configuration.${this.options.dropKeyPath}`]: [
        ...existingItems,
        item.uuid,
      ],
    });
  }

  /* -------------------------------------------- */

  /**
   * Called when an item is dropped to validate the Item before it is saved. An error should be thrown
   * if the item is invalid.
   * @param {Event} event  Triggering drop event.
   * @param {Item5e} item  The materialized Item that was dropped.
   * @throws An error if the item is invalid.
   * @protected
   */
  _validateDroppedItem(event, item) {}
}

/**
 * Base class for the advancement interface displayed by the advancement prompt that should be subclassed by
 * individual advancement types.
 *
 * @param {Item5e} item           Item to which the advancement belongs.
 * @param {string} advancementId  ID of the advancement this flow modifies.
 * @param {number} level          Level for which to configure this flow.
 * @param {object} [options={}]   Application rendering options.
 */
class AdvancementFlow extends FormApplication {
  constructor(item, advancementId, level, options = {}) {
    super({}, options);

    /**
     * The item that houses the Advancement.
     * @type {Item5e}
     */
    this.item = item;

    /**
     * ID of the advancement this flow modifies.
     * @type {string}
     * @private
     */
    this._advancementId = advancementId;

    /**
     * Level for which to configure this flow.
     * @type {number}
     */
    this.level = level;

    /**
     * Data retained by the advancement manager during a reverse step. If restoring data using Advancement#restore,
     * this data should be used when displaying the flow's form.
     * @type {object|null}
     */
    this.retainedData = null;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      template: "systems/sds/templates/advancement/advancement-flow.hbs",
      popOut: false,
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  get id() {
    return `actor-${this.advancement.item.id}-advancement-${this.advancement.id}-${this.level}`;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  get title() {
    return this.advancement.title;
  }

  /* -------------------------------------------- */

  /**
   * The Advancement object this flow modifies.
   * @type {Advancement|null}
   */
  get advancement() {
    return this.item.advancement?.byId[this._advancementId] ?? null;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  getData() {
    return {
      appId: this.id,
      advancement: this.advancement,
      type: this.advancement.constructor.typeName,
      title: this.title,
      summary: this.advancement.summaryForLevel(this.level),
      level: this.level,
    };
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async _updateObject(event, formData) {
    await this.advancement.apply(this.level, formData);
  }
}

/**
 * Data field that selects the appropriate advancement data model if available, otherwise defaults to generic
 * `ObjectField` to prevent issues with custom advancement types that aren't currently loaded.
 */
class AdvancementField extends foundry.data.fields.ObjectField {
  /**
   * Get the BaseAdvancement definition for the specified advancement type.
   * @param {string} type                    The Advancement type.
   * @returns {typeof BaseAdvancement|null}  The BaseAdvancement class, or null.
   */
  getModelForType(type) {
    return CONFIG.SdS.advancementTypes[type] ?? null;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _cleanType(value, options) {
    if (!(typeof value === "object")) value = {};

    const cls = this.getModelForType(value.type);
    if (cls) return cls.cleanData(value, options);
    return value;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  initialize(value, model, options = {}) {
    const cls = this.getModelForType(value.type);
    if (cls) return new cls(value, { parent: model, ...options });
    return foundry.utils.deepClone(value);
  }
}

/* -------------------------------------------- */

/**
 * Data field that automatically selects the Advancement-specific configuration or value data models.
 *
 * @param {Advancement} advancementType  Advancement class to which this field belongs.
 */
class AdvancementDataField extends foundry.data.fields.ObjectField {
  constructor(advancementType, options = {}) {
    super(options);
    this.advancementType = advancementType;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static get _defaults() {
    return foundry.utils.mergeObject(super._defaults, { required: true });
  }

  /**
   * Get the DataModel definition for the specified field as defined in metadata.
   * @returns {typeof DataModel|null}  The DataModel class, or null.
   */
  getModel() {
    return this.advancementType.metadata?.dataModels?.[this.name];
  }

  /* -------------------------------------------- */

  /**
   * Get the defaults object for the specified field as defined in metadata.
   * @returns {object}
   */
  getDefaults() {
    return this.advancementType.metadata?.defaults?.[this.name] ?? {};
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _cleanType(value, options) {
    if (!(typeof value === "object")) value = {};

    // Use a defined DataModel
    const cls = this.getModel();
    if (cls) return cls.cleanData(value, options);
    if (options.partial) return value;

    // Use the defined defaults
    const defaults = this.getDefaults();
    return foundry.utils.mergeObject(defaults, value, { inplace: false });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  initialize(value, model, options = {}) {
    const cls = this.getModel();
    if (cls) return new cls(value, { parent: model, ...options });
    return foundry.utils.deepClone(value);
  }
}

/* -------------------------------------------- */

/**
 * @typedef {StringFieldOptions} FormulaFieldOptions
 * @property {boolean} [deterministic=false]  Is this formula not allowed to have dice values?
 */

/**
 * Special case StringField which represents a formula.
 *
 * @param {FormulaFieldOptions} [options={}]  Options which configure the behavior of the field.
 * @property {boolean} deterministic=false    Is this formula not allowed to have dice values?
 */
class FormulaField extends foundry.data.fields.StringField {
  /** @inheritdoc */
  static get _defaults() {
    return foundry.utils.mergeObject(super._defaults, {
      deterministic: false,
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _validateType(value) {
    if (this.options.deterministic) {
      const roll = new Roll(value);
      if (!roll.isDeterministic) throw new Error("must not contain dice terms");
      Roll.safeEval(roll.formula);
    } else Roll.validate(value);
    super._validateType(value);
  }
}

/* -------------------------------------------- */

/**
 * Special case StringField that includes automatic validation for identifiers.
 */
class IdentifierField extends foundry.data.fields.StringField {
  /** @override */
  _validateType(value) {
    if (!sds.utils.validators.isValidIdentifier(value)) {
      throw new Error(game.i18n.localize("SdS.IdentifierError"));
    }
  }
}

/* -------------------------------------------- */

/**
 * @typedef {DataFieldOptions} MappingFieldOptions
 * @property {string[]} [initialKeys]  Keys that will be created if no data is provided.
 */

/**
 * A subclass of ObjectField that represents a mapping of keys to the provided DataField type.
 *
 * @param {DataField} model                    The class of DataField which should be embedded in this field.
 * @param {MappingFieldOptions} [options={}]   Options which configure the behavior of the field.
 * @property {string[]} [initialKeys]          Keys that will be created if no data is provided.
 */
class MappingField extends foundry.data.fields.ObjectField {
  constructor(model, options) {
    if (!(model instanceof foundry.data.fields.DataField)) {
      throw new Error(
        "MappingField must have a DataField as its contained element"
      );
    }
    super(options);

    /**
     * The embedded DataField definition which is contained in this field.
     * @type {DataField}
     */
    this.model = model;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static get _defaults() {
    return foundry.utils.mergeObject(super._defaults, {
      initialKeys: null,
      initialValue: null,
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _cleanType(value, options) {
    Object.entries(value).forEach(
      ([k, v]) => (value[k] = this.model.clean(v, options))
    );
    return value;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  getInitialValue(data) {
    let keys = this.initialKeys;
    const initial = super.getInitialValue(data);
    if (!keys || !foundry.utils.isEmpty(initial)) return initial;
    if (!(keys instanceof Array)) keys = Object.keys(keys);
    for (const key of keys) {
      const modelInitial = this.model.getInitialValue();
      initial[key] = this.initialValue?.(key, modelInitial) ?? modelInitial;
    }
    return initial;
  }

  /* -------------------------------------------- */

  /** @override */
  _validateType(value, options = {}) {
    if (foundry.utils.getType(value) !== "Object")
      throw new Error("must be an Object");
    const errors = this._validateValues(value, options);
    if (!foundry.utils.isEmpty(errors))
      throw new foundry.data.fields.ModelValidationError(errors);
  }

  /* -------------------------------------------- */

  /**
   * Validate each value of the object.
   * @param {object} value     The object to validate.
   * @param {object} options   Validation options.
   * @returns {Object<Error>}  An object of value-specific errors by key.
   */
  _validateValues(value, options) {
    const errors = {};
    for (const [k, v] of Object.entries(value)) {
      const error = this.model.validate(v, options);
      if (error) errors[k] = error;
    }
    return errors;
  }

  /* -------------------------------------------- */

  /** @override */
  initialize(value, model, options = {}) {
    if (!value) return value;
    return Object.entries(value).reduce((obj, [k, v]) => {
      obj[k] = this.model.initialize(v, model, options);
      return obj;
    }, {});
  }
}

var fields = /*#__PURE__*/ Object.freeze({
  __proto__: null,
  AdvancementDataField: AdvancementDataField,
  AdvancementField: AdvancementField,
  FormulaField: FormulaField,
  IdentifierField: IdentifierField,
  MappingField: MappingField,
});

class BaseAdvancement extends foundry.abstract.DataModel {
  /**
   * Name of this advancement type that will be stored in config and used for lookups.
   * @type {string}
   * @protected
   */
  static get typeName() {
    return this.name.replace(/Advancement$/, "");
  }

  /* -------------------------------------------- */

  static defineSchema() {
    return {
      _id: new foundry.data.fields.DocumentIdField({
        initial: () => foundry.utils.randomID(),
      }),
      type: new foundry.data.fields.StringField({
        required: true,
        initial: this.typeName,
        validate: (v) => v === this.typeName,
        validationError: `must be the same as the Advancement type name ${this.typeName}`,
      }),
      configuration: new AdvancementDataField(this, { required: true }),
      value: new AdvancementDataField(this, { required: true }),
      level: new foundry.data.fields.NumberField({
        integer: true,
        initial: this.metadata?.multiLevel ? undefined : 1,
        min: 0,
        label: "SdS.Level",
      }),
      title: new foundry.data.fields.StringField({
        initial: undefined,
        label: "SdS.AdvancementCustomTitle",
      }),
      icon: new foundry.data.fields.FilePathField({
        initial: undefined,
        categories: ["IMAGE"],
        label: "SdS.AdvancementCustomIcon",
      }),
      classRestriction: new foundry.data.fields.StringField({
        initial: undefined,
        choices: ["primary", "secondary"],
        label: "SdS.AdvancementClassRestriction",
      }),
    };
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  toObject(source = true) {
    if (!source) return super.toObject(source);
    const clone = foundry.utils.deepClone(this._source);
    // Remove any undefined keys from the source data
    Object.keys(clone)
      .filter((k) => clone[k] === undefined)
      .forEach((k) => delete clone[k]);
    return clone;
  }
}

/**
 * Error that can be thrown during the advancement update preparation process.
 */
class AdvancementError extends Error {
  constructor(...args) {
    super(...args);
    this.name = "AdvancementError";
  }
}

/**
 * Abstract base class which various advancement types can subclass.
 * @param {Item5e} item          Item to which this advancement belongs.
 * @param {object} [data={}]     Raw data stored in the advancement object.
 * @param {object} [options={}]  Options which affect DataModel construction.
 * @abstract
 */
let Advancement$1 = class Advancement extends BaseAdvancement {
  constructor(data, { parent = null, ...options } = {}) {
    if (parent instanceof Item) parent = parent.system;
    super(data, { parent, ...options });

    /**
     * A collection of Application instances which should be re-rendered whenever this document is updated.
     * The keys of this object are the application ids and the values are Application instances. Each
     * Application in this object will have its render method called by {@link Document#render}.
     * @type {Object<Application>}
     */
    Object.defineProperty(this, "apps", {
      value: {},
      writable: false,
      enumerable: false,
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _initialize(options) {
    super._initialize(options);
    return this.prepareData();
  }

  static ERROR = AdvancementError;

  /* -------------------------------------------- */

  /**
   * Information on how an advancement type is configured.
   *
   * @typedef {object} AdvancementMetadata
   * @property {object} dataModels
   * @property {DataModel} configuration  Data model used for validating configuration data.
   * @property {DataModel} value          Data model used for validating value data.
   * @property {number} order          Number used to determine default sorting order of advancement items.
   * @property {string} icon           Icon used for this advancement type if no user icon is specified.
   * @property {string} title          Title to be displayed if no user title is specified.
   * @property {string} hint           Description of this type shown in the advancement selection dialog.
   * @property {boolean} multiLevel    Can this advancement affect more than one level? If this is set to true,
   *                                   the level selection control in the configuration window is hidden and the
   *                                   advancement should provide its own implementation of `Advancement#levels`
   *                                   and potentially its own level configuration interface.
   * @property {Set<string>} validItemTypes  Set of types to which this advancement can be added.
   * @property {object} apps
   * @property {*} apps.config         Subclass of AdvancementConfig that allows for editing of this advancement type.
   * @property {*} apps.flow           Subclass of AdvancementFlow that is displayed while fulfilling this advancement.
   */

  /**
   * Configuration information for this advancement type.
   * @type {AdvancementMetadata}
   */
  static get metadata() {
    return {
      order: 100,
      icon: "icons/svg/upgrade.svg",
      title: game.i18n.localize("SdS.AdvancementTitle"),
      hint: "",
      multiLevel: false,
      validItemTypes: new Set(["background", "class", "subclass"]),
      apps: {
        config: AdvancementConfig,
        flow: AdvancementFlow,
      },
    };
  }

  /* -------------------------------------------- */
  /*  Instance Properties                         */
  /* -------------------------------------------- */

  /**
   * Unique identifier for this advancement within its item.
   * @type {string}
   */
  get id() {
    return this._id;
  }

  /* -------------------------------------------- */

  /**
   * Globally unique identifier for this advancement.
   * @type {string}
   */
  get uuid() {
    return `${this.item.uuid}.Advancement.${this.id}`;
  }

  /* -------------------------------------------- */

  /**
   * Item to which this advancement belongs.
   * @type {Item5e}
   */
  get item() {
    return this.parent.parent;
  }

  /* -------------------------------------------- */

  /**
   * Actor to which this advancement's item belongs, if the item is embedded.
   * @type {Actor5e|null}
   */
  get actor() {
    return this.item.parent ?? null;
  }

  /* -------------------------------------------- */

  /**
   * List of levels in which this advancement object should be displayed. Will be a list of class levels if this
   * advancement is being applied to classes or subclasses, otherwise a list of character levels.
   * @returns {number[]}
   */
  get levels() {
    return this.level !== undefined ? [this.level] : [];
  }

  /* -------------------------------------------- */

  /**
   * Should this advancement be applied to a class based on its class restriction setting? This will always return
   * true for advancements that are not within an embedded class item.
   * @type {boolean}
   * @protected
   */
  get appliesToClass() {
    const originalClass = this.item.isOriginalClass;
    return (
      originalClass === null ||
      !this.classRestriction ||
      (this.classRestriction === "primary" && originalClass) ||
      (this.classRestriction === "secondary" && !originalClass)
    );
  }

  /* -------------------------------------------- */
  /*  Preparation Methods                         */
  /* -------------------------------------------- */

  /**
   * Prepare data for the Advancement.
   */
  prepareData() {
    this.title = this.title || this.constructor.metadata.title;
    this.icon = this.icon || this.constructor.metadata.icon;
  }

  /* -------------------------------------------- */
  /*  Display Methods                             */
  /* -------------------------------------------- */

  /**
   * Has the player made choices for this advancement at the specified level?
   * @param {number} level  Level for which to check configuration.
   * @returns {boolean}     Have any available choices been made?
   */
  configuredForLevel(level) {
    return true;
  }

  /* -------------------------------------------- */

  /**
   * Value used for sorting this advancement at a certain level.
   * @param {number} level  Level for which this entry is being sorted.
   * @returns {string}      String that can be used for sorting.
   */
  sortingValueForLevel(level) {
    return `${this.constructor.metadata.order.paddedString(
      4
    )} ${this.titleForLevel(level)}`;
  }

  /* -------------------------------------------- */

  /**
   * Title displayed in advancement list for a specific level.
   * @param {number} level                       Level for which to generate a title.
   * @param {object} [options={}]
   * @param {object} [options.configMode=false]  Is the advancement's item sheet in configuration mode? When in
   *                                             config mode, the choices already made on this actor should not
   *                                             be displayed.
   * @returns {string}                           HTML title with any level-specific information.
   */
  titleForLevel(level, { configMode = false } = {}) {
    return this.title;
  }

  /* -------------------------------------------- */

  /**
   * Summary content displayed beneath the title in the advancement list.
   * @param {number} level                       Level for which to generate the summary.
   * @param {object} [options={}]
   * @param {object} [options.configMode=false]  Is the advancement's item sheet in configuration mode? When in
   *                                             config mode, the choices already made on this actor should not
   *                                             be displayed.
   * @returns {string}                           HTML content of the summary.
   */
  summaryForLevel(level, { configMode = false } = {}) {
    return "";
  }

  /* -------------------------------------------- */

  /**
   * Render all of the Application instances which are connected to this advancement.
   * @param {boolean} [force=false]     Force rendering
   * @param {object} [context={}]       Optional context
   */
  render(force = false, context = {}) {
    for (const app of Object.values(this.apps)) app.render(force, context);
  }

  /* -------------------------------------------- */
  /*  Editing Methods                             */
  /* -------------------------------------------- */

  /**
   * Update this advancement.
   * @param {object} updates          Updates to apply to this advancement.
   * @returns {Promise<Advancement>}  This advancement after updates have been applied.
   */
  async update(updates) {
    this.constructor._migrateUpdateData(updates);
    await this.item.updateAdvancement(this.id, updates);
    return this;
  }

  /* -------------------------------------------- */

  /**
   * Update this advancement's data on the item without performing a database commit.
   * @param {object} updates  Updates to apply to this advancement.
   * @returns {Advancement}   This advancement after updates have been applied.
   */
  updateSource(updates) {
    this.constructor._migrateUpdateData(updates);
    super.updateSource(updates);
    return this;
  }

  /* -------------------------------------------- */

  /**
   * Can an advancement of this type be added to the provided item?
   * @param {Item5e} item  Item to check against.
   * @returns {boolean}    Should this be enabled as an option on the `AdvancementSelection` dialog?
   */
  static availableForItem(item) {
    return true;
  }

  /* -------------------------------------------- */

  /**
   * Serialize salient information for this Advancement when dragging it.
   * @returns {object}  An object of drag data.
   */
  toDragData() {
    const dragData = { type: "Advancement" };
    if (this.id) dragData.uuid = this.uuid;
    else dragData.data = this.toObject();
    return dragData;
  }

  /* -------------------------------------------- */
  /*  Application Methods                         */
  /* -------------------------------------------- */

  /**
   * Locally apply this advancement to the actor.
   * @param {number} level   Level being advanced.
   * @param {object} data    Data from the advancement form.
   * @abstract
   */
  async apply(level, data) {}

  /* -------------------------------------------- */

  /**
   * Locally apply this advancement from stored data, if possible. If stored data can not be restored for any reason,
   * throw an AdvancementError to display the advancement flow UI.
   * @param {number} level  Level being advanced.
   * @param {object} data   Data from `Advancement#reverse` needed to restore this advancement.
   * @abstract
   */
  async restore(level, data) {}

  /* -------------------------------------------- */

  /**
   * Locally remove this advancement's changes from the actor.
   * @param {number} level  Level being removed.
   * @returns {object}      Data that can be passed to the `Advancement#restore` method to restore this reversal.
   * @abstract
   */
  async reverse(level) {}

  /* -------------------------------------------- */
  /*  Deprecations and Compatibility              */
  /* -------------------------------------------- */

  /**
   * @deprecated since 2.1.0
   * @ignore
   */
  get data() {
    foundry.utils.logCompatibilityWarning(
      `You are accessing the ${this.constructor.name}#data object which is no longer used. ` +
        "Since 2.1 the Advancement class and its contained DataModel are merged into a combined data structure. " +
        "You should now reference keys which were previously contained within the data object directly.",
      { since: "SdS 2.1", until: "SdS 2.2" }
    );
    const data = {};
    for (const k of this.schema.keys()) {
      data[k] = this[k];
    }
    return this.constructor.shimData(data, { embedded: false });
  }

  /**
   * Shim to remove leading `data.` from updates.
   * @ignore
   */
  static _migrateUpdateData(updates) {
    let logWarning = false;
    for (const [key, value] of Object.entries(updates)) {
      if (key.startsWith("data.")) {
        updates[key.substring(5)] = value;
        delete updates[key];
        logWarning = true;
      }
    }
    if (updates.data) {
      Object.assign(updates, updates.data);
      delete updates.data;
      logWarning = true;
    }
    if (logWarning)
      foundry.utils.logCompatibilityWarning(
        "An update being performed on an advancement points to `data`. Advancement data has moved to the top level so the" +
          " leading `data.` is no longer required.",
        { since: "SdS 2.1", until: "SdS 2.2" }
      );
    return updates;
  }
};

/**
 * Configuration application for hit points.
 */
class HitPointsConfig extends AdvancementConfig {
  /** @inheritdoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      template: "systems/sds/templates/advancement/hit-points-config.hbs",
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  getData() {
    return foundry.utils.mergeObject(super.getData(), {
      hitDie: this.advancement.hitDie,
    });
  }
}

/**
 * Configuration application for mana points.
 */
class ManaPointsConfig extends AdvancementConfig {
  /** @inheritdoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      template: "systems/sds/templates/advancement/mana-points-config.hbs",
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  getData() {
    return foundry.utils.mergeObject(super.getData(), {
      mana_percentage: this.advancement.mana_percentage,
    });
  }
}

/**
 * Inline application that presents hit points selection upon level up.
 */
class HitPointsFlow extends AdvancementFlow {
  /** @inheritdoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      template: "systems/sds/templates/advancement/hit-points-flow.hbs",
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  getData() {
    const source = this.retainedData ?? this.advancement.value;
    const value = source[this.level];

    // If value is empty, `useAverage` should default to the value selected at the previous level
    let useAverage = value === "avg";
    if (!value) {
      const lastValue = source[this.level - 1];
      if (lastValue === "avg") useAverage = true;
    }

    return foundry.utils.mergeObject(super.getData(), {
      isFirstClassLevel:
        this.level === 1 && this.advancement.item.isOriginalClass,
      hitDie: this.advancement.hitDie,
      dieValue: this.advancement.hitDieValue,
      data: {
        value: Number.isInteger(value) ? value : "",
        useAverage,
      },
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  activateListeners(html) {
    this.form
      .querySelector(".averageCheckbox")
      ?.addEventListener("change", (event) => {
        this.form.querySelector(".rollResult").disabled = event.target.checked;
        this.form.querySelector(".rollButton").disabled = event.target.checked;
        this._updateRollResult();
      });
    this.form
      .querySelector(".rollButton")
      ?.addEventListener("click", async () => {
        const roll = await this.advancement.actor.rollClassHitPoints(
          this.advancement.item
        );
        this.form.querySelector(".rollResult").value = roll.total;
      });
    this._updateRollResult();
  }

  /* -------------------------------------------- */

  /**
   * Update the roll result display when the average result is taken.
   * @protected
   */
  _updateRollResult() {
    if (!this.form.elements.useAverage?.checked) return;
    this.form.elements.value.value = this.advancement.hitDieValue / 2 + 1;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _updateObject(event, formData) {
    let value;
    if (formData.useMax) value = "max";
    else if (formData.useAverage) value = "avg";
    else if (Number.isInteger(formData.value)) value = parseInt(formData.value);

    if (value !== undefined)
      return this.advancement.apply(this.level, { [this.level]: value });

    this.form.querySelector(".rollResult")?.classList.add("error");
    const errorType = formData.value ? "Invalid" : "Empty";
    throw new Advancement.ERROR(
      game.i18n.localize(`SdS.AdvancementHitPoints${errorType}Error`)
    );
  }
}

/**
 * Inline application that presents mana points selection upon level up.
 */
class ManaPointsFlow extends AdvancementFlow {
  /** @inheritdoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      template: "systems/sds/templates/advancement/mana-points-flow.hbs",
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  getData() {
    const mana = SdS.MANA_PER_LEVEL[this.level];
    const mana_percentage = this.advancement.mana_percentage;
    const total_mana = mana * mana_percentage;

    return foundry.utils.mergeObject(super.getData(), {
      mana: mana,
      mana_percentage: mana_percentage,
      total_mana: total_mana,
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _updateObject(event, formData) {
    let value = parseInt(formData.mana);

    if (value !== undefined)
      return this.advancement.apply(this.level, { [this.level]: value });

    this.form.querySelector(".rollResult")?.classList.add("error");
    const errorType = formData.mana ? "Invalid" : "Empty";
    throw new Advancement.ERROR(
      game.i18n.localize(`SdS.AdvancementHitPoints${errorType}Error`)
    );
  }
}

/* -------------------------------------------- */
/*  Formulas                                    */
/* -------------------------------------------- */

/**
 * Convert a bonus value to a simple integer for displaying on the sheet.
 * @param {number|string|null} bonus  Bonus formula.
 * @param {object} [data={}]          Data to use for replacing @ strings.
 * @returns {number}                  Simplified bonus as an integer.
 * @protected
 */
function simplifyBonus(bonus, data = {}) {
  if (!bonus) return 0;
  if (Number.isNumeric(bonus)) return Number(bonus);
  try {
    const roll = new Roll(bonus, data);
    return roll.isDeterministic ? Roll.safeEval(roll.formula) : 0;
  } catch (error) {
    console.error(error);
    return 0;
  }
}

/* -------------------------------------------- */
/*  Object Helpers                              */
/* -------------------------------------------- */

/**
 * Sort the provided object by its values or by an inner sortKey.
 * @param {object} obj        The object to sort.
 * @param {string} [sortKey]  An inner key upon which to sort.
 * @returns {object}          A copy of the original object that has been sorted.
 */
function sortObjectEntries(obj, sortKey) {
  let sorted = Object.entries(obj);
  if (sortKey)
    sorted = sorted.sort((a, b) => a[1][sortKey].localeCompare(b[1][sortKey]));
  else sorted = sorted.sort((a, b) => a[1].localeCompare(b[1]));
  return Object.fromEntries(sorted);
}

/* -------------------------------------------- */

/**
 * Retrieve the indexed data for a Document using its UUID. Will never return a result for embedded documents.
 * @param {string} uuid  The UUID of the Document index to retrieve.
 * @returns {object}     Document's index if one could be found.
 */
function indexFromUuid(uuid) {
  const parts = uuid.split(".");
  let index;

  // Compendium Documents
  if (parts[0] === "Compendium") {
    const [, scope, packName, id] = parts;
    const pack = game.packs.get(`${scope}.${packName}`);
    index = pack?.index.get(id);
  }

  // World Documents
  else if (parts.length < 3) {
    const [docName, id] = parts;
    const collection = CONFIG[docName].collection.instance;
    index = collection.get(id);
  }

  return index || null;
}

/* -------------------------------------------- */

/**
 * Creates an HTML document link for the provided UUID.
 * @param {string} uuid  UUID for which to produce the link.
 * @returns {string}     Link to the item or empty string if item wasn't found.
 */
function linkForUuid(uuid) {
  return TextEditor._createContentLink(["", "UUID", uuid]).outerHTML;
}

/* -------------------------------------------- */
/*  Validators                                  */
/* -------------------------------------------- */

/**
 * Ensure the provided string contains only the characters allowed in identifiers.
 * @param {string} identifier
 * @returns {boolean}
 */
function isValidIdentifier(identifier) {
  return /^([a-z0-9_-]+)$/i.test(identifier);
}

const validators = {
  isValidIdentifier: isValidIdentifier,
};

/* -------------------------------------------- */
/*  Handlebars Template Helpers                 */
/* -------------------------------------------- */

/**
 * Define a set of template paths to pre-load. Pre-loaded templates are compiled and cached for fast access when
 * rendering. These paths will also be available as Handlebars partials by using the file name
 * (e.g. "sds.actor-traits").
 * @returns {Promise}
 */
async function preloadHandlebarsTemplates() {
  const partials = [
    // Shared Partials
    "systems/sds/templates/actors/parts/active-effects.hbs",
    "systems/sds/templates/apps/parts/trait-list.hbs",

    // Actor Sheet Partials
    "systems/sds/templates/actors/parts/actor-traits.hbs",
    "systems/sds/templates/actors/parts/actor-inventory.hbs",
    "systems/sds/templates/actors/parts/actor-features.hbs",
    "systems/sds/templates/actors/parts/actor-spellbook.hbs",
    "systems/sds/templates/actors/parts/actor-warnings.hbs",

    // Item Sheet Partials
    "systems/sds/templates/items/parts/item-action.hbs",
    "systems/sds/templates/items/parts/item-activation.hbs",
    "systems/sds/templates/items/parts/item-advancement.hbs",
    "systems/sds/templates/items/parts/item-description.hbs",
    "systems/sds/templates/items/parts/item-mountable.hbs",
    "systems/sds/templates/items/parts/item-spellcasting.hbs",
    "systems/sds/templates/items/parts/item-summary.hbs",

    // Journal Partials
    "systems/sds/templates/journal/parts/journal-table.hbs",

    // Advancement Partials
    "systems/sds/templates/advancement/parts/advancement-controls.hbs",
    "systems/sds/templates/advancement/parts/advancement-spell-config.hbs",
  ];

  const paths = {};
  for (const path of partials) {
    paths[path.replace(".hbs", ".html")] = path;
    paths[`sds.${path.split("/").pop().replace(".hbs", "")}`] = path;
  }

  return loadTemplates(paths);
}

/* -------------------------------------------- */

/**
 * A helper that fetch the appropriate item context from root and adds it to the first block parameter.
 * @param {object} context  Current evaluation context.
 * @param {object} options  Handlebars options.
 * @returns {string}
 */
function itemContext(context, options) {
  if (arguments.length !== 2)
    throw new Error("#sds-with requires exactly one argument");
  if (foundry.utils.getType(context) === "function")
    context = context.call(this);

  const ctx = options.data.root.itemContext?.[context.id];
  if (!ctx) {
    const inverse = options.inverse(this);
    if (inverse) return options.inverse(this);
  }

  return options.fn(context, { data: options.data, blockParams: [ctx] });
}

/* -------------------------------------------- */

/**
 * Register custom Handlebars helpers used by 5e.
 */
function registerHandlebarsHelpers() {
  Handlebars.registerHelper({
    getProperty: foundry.utils.getProperty,
    "sds-linkForUuid": linkForUuid,
    "sds-itemContext": itemContext,
  });
}

/* -------------------------------------------- */
/*  Config Pre-Localization                     */
/* -------------------------------------------- */

/**
 * Storage for pre-localization configuration.
 * @type {object}
 * @private
 */
const _preLocalizationRegistrations = {};

/**
 * Mark the provided config key to be pre-localized during the init stage.
 * @param {string} configKeyPath          Key path within `CONFIG.SdS` to localize.
 * @param {object} [options={}]
 * @param {string} [options.key]          If each entry in the config enum is an object,
 *                                        localize and sort using this property.
 * @param {string[]} [options.keys=[]]    Array of localization keys. First key listed will be used for sorting
 *                                        if multiple are provided.
 * @param {boolean} [options.sort=false]  Sort this config enum, using the key if set.
 */
function preLocalize(configKeyPath, { key, keys = [], sort = false } = {}) {
  if (key) keys.unshift(key);
  _preLocalizationRegistrations[configKeyPath] = { keys, sort };
}

/* -------------------------------------------- */

/**
 * Execute previously defined pre-localization tasks on the provided config object.
 * @param {object} config  The `CONFIG.SdS` object to localize and sort. *Will be mutated.*
 */
function performPreLocalization(config) {
  for (const [keyPath, settings] of Object.entries(
    _preLocalizationRegistrations
  )) {
    const target = foundry.utils.getProperty(config, keyPath);
    _localizeObject(target, settings.keys);
    if (settings.sort)
      foundry.utils.setProperty(
        config,
        keyPath,
        sortObjectEntries(target, settings.keys[0])
      );
  }
}

/* -------------------------------------------- */

/**
 * Localize the values of a configuration object by translating them in-place.
 * @param {object} obj       The configuration object to localize.
 * @param {string[]} [keys]  List of inner keys that should be localized if this is an object.
 * @private
 */
function _localizeObject(obj, keys) {
  for (const [k, v] of Object.entries(obj)) {
    const type = typeof v;
    if (type === "string") {
      obj[k] = game.i18n.localize(v);
      continue;
    }

    if (type !== "object") {
      console.error(
        new Error(
          `Pre-localized configuration values must be a string or object, ${type} found for "${k}" instead.`
        )
      );
      continue;
    }
    if (!keys?.length) {
      console.error(
        new Error(
          "Localization keys must be provided for pre-localizing when target is an object."
        )
      );
      continue;
    }

    for (const key of keys) {
      if (!v[key]) continue;
      v[key] = game.i18n.localize(v[key]);
    }
  }
}

/* -------------------------------------------- */
/*  Migration                                   */
/* -------------------------------------------- */

/**
 * Synchronize the spells for all Actors in some collection with source data from an Item compendium pack.
 * @param {CompendiumCollection} actorPack      An Actor compendium pack which will be updated
 * @param {CompendiumCollection} spellsPack     An Item compendium pack which provides source data for spells
 * @returns {Promise<void>}
 */
async function synchronizeActorSpells(actorPack, spellsPack) {
  // Load all actors and spells
  const actors = await actorPack.getDocuments();
  const spells = await spellsPack.getDocuments();
  const spellsMap = spells.reduce((obj, item) => {
    obj[item.name] = item;
    return obj;
  }, {});

  // Unlock the pack
  await actorPack.configure({ locked: false });

  // Iterate over actors
  SceneNavigation.displayProgressBar({
    label: "Synchronizing Spell Data",
    pct: 0,
  });
  for (const [i, actor] of actors.entries()) {
    const { toDelete, toCreate } = _synchronizeActorSpells(actor, spellsMap);
    if (toDelete.length) await actor.deleteEmbeddedDocuments("Item", toDelete);
    if (toCreate.length)
      await actor.createEmbeddedDocuments("Item", toCreate, { keepId: true });
    console.debug(`${actor.name} | Synchronized ${toCreate.length} spells`);
    SceneNavigation.displayProgressBar({
      label: actor.name,
      pct: ((i / actors.length) * 100).toFixed(0),
    });
  }

  // Re-lock the pack
  await actorPack.configure({ locked: true });
  SceneNavigation.displayProgressBar({
    label: "Synchronizing Spell Data",
    pct: 100,
  });
}

/* -------------------------------------------- */

/**
 * A helper function to synchronize spell data for a specific Actor.
 * @param {Actor5e} actor
 * @param {Object<string,Item5e>} spellsMap
 * @returns {{toDelete: string[], toCreate: object[]}}
 * @private
 */
function _synchronizeActorSpells(actor, spellsMap) {
  const spells = actor.itemTypes.spell;
  const toDelete = [];
  const toCreate = [];
  if (!spells.length) return { toDelete, toCreate };

  for (const spell of spells) {
    const source = spellsMap[spell.name];
    if (!source) {
      console.warn(
        `${actor.name} | ${spell.name} | Does not exist in spells compendium pack`
      );
      continue;
    }

    // Combine source data with the preparation and uses data from the actor
    const spellData = source.toObject();
    const { preparation, uses, save } = spell.toObject().system;
    Object.assign(spellData.system, { preparation, uses });
    spellData.system.save.dc = save.dc;
    foundry.utils.setProperty(spellData, "flags.core.sourceId", source.uuid);

    // Record spells to be deleted and created
    toDelete.push(spell.id);
    toCreate.push(spellData);
  }
  return { toDelete, toCreate };
}

var utils = /*#__PURE__*/ Object.freeze({
  __proto__: null,
  indexFromUuid: indexFromUuid,
  linkForUuid: linkForUuid,
  performPreLocalization: performPreLocalization,
  preLocalize: preLocalize,
  preloadHandlebarsTemplates: preloadHandlebarsTemplates,
  registerHandlebarsHelpers: registerHandlebarsHelpers,
  simplifyBonus: simplifyBonus,
  sortObjectEntries: sortObjectEntries,
  synchronizeActorSpells: synchronizeActorSpells,
  validators: validators,
});

/**
 * Advancement that presents the player with the option to roll hit points at each level or select the average value.
 * Keeps track of player hit point rolls or selection for each class level. **Can only be added to classes and each
 * class can only have one.**
 */
class HitPointsAdvancement extends Advancement$1 {
  /** @inheritdoc */
  static get metadata() {
    return foundry.utils.mergeObject(super.metadata, {
      order: 10,
      icon: "systems/sds/icons/svg/hit-points.svg",
      title: game.i18n.localize("SdS.AdvancementHitPointsTitle"),
      hint: game.i18n.localize("SdS.AdvancementHitPointsHint"),
      multiLevel: true,
      validItemTypes: new Set(["class"]),
      apps: {
        config: HitPointsConfig,
        flow: HitPointsFlow,
      },
    });
  }

  /* -------------------------------------------- */
  /*  Instance Properties                         */
  /* -------------------------------------------- */

  /** @inheritdoc */
  get levels() {
    return Array.fromRange(CONFIG.SdS.maxLevel + 1).slice(1);
  }

  /* -------------------------------------------- */

  /**
   * Shortcut to the hit die used by the class.
   * @returns {string}
   */
  get hitDie() {
    return this.item.system.hitDice;
  }

  /* -------------------------------------------- */

  /**
   * The face value of the hit die used.
   * @returns {number}
   */
  get hitDieValue() {
    return Number(this.hitDie.substring(1));
  }

  /* -------------------------------------------- */
  /*  Display Methods                             */
  /* -------------------------------------------- */

  /** @inheritdoc */
  configuredForLevel(level) {
    return this.valueForLevel(level) !== null;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  titleForLevel(level, { configMode = false } = {}) {
    const hp = this.valueForLevel(level);
    if (!hp || configMode) return this.title;
    return `${this.title}: <strong>${hp}</strong>`;
  }

  /* -------------------------------------------- */

  /**
   * Hit points given at the provided level.
   * @param {number} level   Level for which to get hit points.
   * @returns {number|null}  Hit points for level or null if none have been taken.
   */
  valueForLevel(level) {
    return this.constructor.valueForLevel(this.value, this.hitDieValue, level);
  }

  /* -------------------------------------------- */

  /**
   * Hit points given at the provided level.
   * @param {object} data         Contents of `value` used to determine this value.
   * @param {number} hitDieValue  Face value of the hit die used by this advancement.
   * @param {number} level        Level for which to get hit points.
   * @returns {number|null}       Hit points for level or null if none have been taken.
   */
  static valueForLevel(data, hitDieValue, level) {
    const value = data[level];
    if (!value) return null;

    if (value === "max") return hitDieValue;
    if (value === "avg") return hitDieValue / 2 + 1;
    return value;
  }

  /* -------------------------------------------- */

  /**
   * Total hit points provided by this advancement.
   * @returns {number}  Hit points currently selected.
   */
  total() {
    return Object.keys(this.value).reduce(
      (total, level) => total + this.valueForLevel(parseInt(level)),
      0
    );
  }

  /* -------------------------------------------- */

  /**
   * Total hit points taking the provided ability modifier into account, with a minimum of 1 per level.
   * @param {number} mod  Modifier to add per level.
   * @returns {number}    Total hit points plus modifier.
   */
  getAdjustedTotal(mod) {
    return Object.keys(this.value).reduce((total, level) => {
      return total + Math.max(this.valueForLevel(parseInt(level)) + mod, 1);
    }, 0);
  }

  /* -------------------------------------------- */
  /*  Editing Methods                             */
  /* -------------------------------------------- */

  /** @inheritdoc */
  static availableForItem(item) {
    return !item.advancement.byType.HitPoints?.length;
  }

  /* -------------------------------------------- */
  /*  Application Methods                         */
  /* -------------------------------------------- */

  /**
   * Add the ability modifier and any bonuses to the provided hit points value to get the number to apply.
   * @param {number} value  Hit points taken at a given level.
   * @returns {number}      Hit points adjusted with ability modifier and per-level bonuses.
   */
  #getApplicableValue(value) {
    const abilityId = CONFIG.SdS.hitPointsAbility || "con";
    value = Math.max(
      value + (this.actor.system.abilities[abilityId]?.mod ?? 0),
      1
    );
    value += simplifyBonus(
      this.actor.system.attributes.hp.bonuses.level,
      this.actor.getRollData()
    );
    return value;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  apply(level, data) {
    let value = this.constructor.valueForLevel(data, this.hitDieValue, level);
    if (value === undefined) return;
    this.actor.updateSource({
      "system.attributes.hp.value":
        this.actor.system.attributes.hp.value + this.#getApplicableValue(value),
    });
    this.actor.updateSource({
      "system.attributes.hp.max":
        this.actor.system.attributes.hp.max + this.#getApplicableValue(value),
    });
    this.updateSource({ value: data });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  restore(level, data) {
    this.apply(level, data);
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  reverse(level) {
    let value = this.valueForLevel(level);
    if (value === undefined) return;
    this.actor.updateSource({
      "system.attributes.hp.value":
        this.actor.system.attributes.hp.value - this.#getApplicableValue(value),
    });
    this.actor.updateSource({
      "system.attributes.hp.max":
        this.actor.system.attributes.hp.max - this.#getApplicableValue(value),
    });
    const source = { [level]: this.value[level] };
    this.updateSource({ [`value.-=${level}`]: null });
    return source;
  }
}

class ManaPointsAdvancement extends Advancement$1 {
  /** @inheritdoc */
  static get metadata() {
    return foundry.utils.mergeObject(super.metadata, {
      order: 10,
      icon: "systems/sds/icons/svg/mana-points.svg",
      title: game.i18n.localize("SdS.AdvancementManaPointsTitle"),
      hint: game.i18n.localize("SdS.AdvancementManaPointsHint"),
      multiLevel: true,
      validItemTypes: new Set(["class"]),
      apps: {
        config: ManaPointsConfig,
        flow: ManaPointsFlow,
      },
    });
  }

  /* -------------------------------------------- */
  /*  Instance Properties                         */
  /* -------------------------------------------- */

  /** @inheritdoc */
  get levels() {
    return Array.fromRange(CONFIG.SdS.maxLevel + 1).slice(1);
  }

  /* -------------------------------------------- */

  /**
   * Shortcut to the mana multiplier used by the class.
   * @returns {string}
   */
  get mana_percentage() {
    return this.item.system.mana_percentage;
  }

  /* -------------------------------------------- */
  /*  Display Methods                             */
  /* -------------------------------------------- */

  /** @inheritdoc */
  configuredForLevel(level) {
    return this.valueForLevel(level) !== null;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  titleForLevel(level, { configMode = false } = {}) {
    const hp = this.valueForLevel(level);
    if (!hp || configMode) return this.title;
    return `${this.title}: <strong>${hp}</strong>`;
  }

  /* -------------------------------------------- */

  valueForLevel(level) {
    return this.constructor.valueForLevel(
      this.value,
      this.mana_percentage,
      level
    );
  }

  /* -------------------------------------------- */

  static valueForLevel(data, percentage, level) {
    const value = data[level];
    if (!value) return null;

    return value * percentage;
  }

  /* -------------------------------------------- */

  total() {
    return Object.keys(this.value).reduce(
      (total, level) => total + this.valueForLevel(parseInt(level)),
      0
    );
  }

  /* -------------------------------------------- */

  /**
   * Total hit points taking the provided ability modifier into account, with a minimum of 1 per level.
   * @param {number} mod  Modifier to add per level.
   * @returns {number}    Total hit points plus modifier.
   */
  getAdjustedTotal(mod) {
    return Object.keys(this.value).reduce((total, level) => {
      return total + Math.max(this.valueForLevel(parseInt(level)) + mod, 1);
    }, 0);
  }

  /* -------------------------------------------- */
  /*  Editing Methods                             */
  /* -------------------------------------------- */

  /** @inheritdoc */
  static availableForItem(item) {
    return !item.advancement.byType.HitPoints?.length;
  }

  /* -------------------------------------------- */
  /*  Application Methods                         */
  /* -------------------------------------------- */

  /**
   * Add the ability modifier and any bonuses to the provided hit points value to get the number to apply.
   * @param {number} value  Hit points taken at a given level.
   * @returns {number}      Hit points adjusted with ability modifier and per-level bonuses.
   */
  #getApplicableValue(value) {
    value += simplifyBonus(
      this.actor.system.attributes.mana.bonuses.level,
      this.actor.getRollData()
    );
    return value;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  apply(level, data) {
    let value = this.constructor.valueForLevel(
      data,
      this.mana_percentage,
      level
    );
    if (value === undefined) return;
    this.actor.updateSource({
      "system.attributes.mana.value": this.#getApplicableValue(value),
    });
    this.actor.updateSource({
      "system.attributes.mana.max": this.#getApplicableValue(value),
    });
    this.updateSource({ value: data });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  restore(level, data) {
    this.apply(level, data);
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  reverse(level) {
    let value = this.valueForLevel(level);
    if (value === undefined) return;
    this.actor.updateSource({
      "system.attributes.mana.value":
        this.actor.system.attributes.mana.value -
        this.#getApplicableValue(value),
    });
    this.actor.updateSource({
      "system.attributes.mana.max":
        this.actor.system.attributes.mana.max - this.#getApplicableValue(value),
    });
    const source = { [level]: this.value[level] };
    this.updateSource({ [`value.-=${level}`]: null });
    return source;
  }
}

/**
 * Configuration application for item grants.
 */
class ItemGrantConfig extends AdvancementConfig {
  /** @inheritdoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      dragDrop: [{ dropSelector: ".drop-target" }],
      dropKeyPath: "items",
      template: "systems/sds/templates/advancement/item-grant-config.hbs",
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  getData() {
    const context = super.getData();
    context.showSpellConfig = context.configuration.items
      .map(fromUuidSync)
      .some((i) => i.type === "spell");
    return context;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _validateDroppedItem(event, item) {
    if (this.advancement.constructor.VALID_TYPES.has(item.type)) return true;
    const type = game.i18n.localize(`ITEM.Type${item.type.capitalize()}`);
    throw new Error(
      game.i18n.format("SdS.AdvancementItemTypeInvalidWarning", { type })
    );
  }
}

/**
 * Inline application that presents the player with a list of items to be added.
 */
class ItemGrantFlow extends AdvancementFlow {
  /** @inheritdoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      template: "systems/sds/templates/advancement/item-grant-flow.hbs",
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async getData() {
    const config = this.advancement.configuration.items;
    const added =
      this.retainedData?.items.map((i) =>
        foundry.utils.getProperty(i, "flags.sds.sourceId")
      ) ?? this.advancement.value.added;
    const checked = new Set(Object.values(added ?? {}));

    const items = await Promise.all(config.map(fromUuid));
    return foundry.utils.mergeObject(super.getData(), {
      optional: this.advancement.configuration.optional,
      items: items.reduce((arr, item) => {
        if (!item) return arr;
        item.checked = added ? checked.has(item.uuid) : true;
        arr.push(item);
        return arr;
      }, []),
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  activateListeners(html) {
    super.activateListeners(html);
    html.find("a[data-uuid]").click(this._onClickFeature.bind(this));
  }

  /* -------------------------------------------- */

  /**
   * Handle clicking on a feature during item grant to preview the feature.
   * @param {MouseEvent} event  The triggering event.
   * @protected
   */
  async _onClickFeature(event) {
    event.preventDefault();
    const uuid = event.currentTarget.dataset.uuid;
    const item = await fromUuid(uuid);
    item?.sheet.render(true);
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async _updateObject(event, formData) {
    const retainedData = this.retainedData?.items.reduce((obj, i) => {
      obj[foundry.utils.getProperty(i, "flags.sds.sourceId")] = i;
      return obj;
    }, {});
    await this.advancement.apply(this.level, formData, retainedData);
  }
}

class SpellConfigurationData extends foundry.abstract.DataModel {
  static defineSchema() {
    return {
      ability: new foundry.data.fields.StringField({
        label: "SdS.AbilityModifier",
      }),
      preparation: new foundry.data.fields.StringField({
        label: "SdS.SpellPreparationMode",
      }),
      uses: new foundry.data.fields.SchemaField(
        {
          max: new FormulaField({
            deterministic: true,
            label: "SdS.UsesMax",
          }),
          per: new foundry.data.fields.StringField({
            label: "SdS.UsesPeriod",
          }),
        },
        { label: "SdS.LimitedUses" }
      ),
    };
  }

  /* -------------------------------------------- */

  /**
   * Changes that this spell configuration indicates should be performed on spells.
   * @type {object}
   */
  get spellChanges() {
    const updates = {};
    if (this.ability) updates["system.ability"] = this.ability;
    if (this.preparation) updates["system.preparation.mode"] = this.preparation;
    if (this.uses.max && this.uses.per) {
      updates["system.uses.max"] = this.uses.max;
      updates["system.uses.per"] = this.uses.per;
      if (Number.isNumeric(this.uses.max))
        updates["system.uses.value"] = parseInt(this.uses.max);
      else {
        try {
          const rollData = this.parent.parent.actor.getRollData({
            deterministic: true,
          });
          const formula = Roll.replaceFormulaData(this.uses.max, rollData, {
            missing: 0,
          });
          updates["system.uses.value"] = Roll.safeEval(formula);
        } catch (e) {}
      }
    }
    return updates;
  }
}

class ItemGrantConfigurationData extends foundry.abstract.DataModel {
  static defineSchema() {
    return {
      items: new foundry.data.fields.ArrayField(
        new foundry.data.fields.StringField(),
        {
          required: true,
          label: "DOCUMENT.Items",
        }
      ),
      optional: new foundry.data.fields.BooleanField({
        required: true,
        label: "SdS.AdvancementItemGrantOptional",
        hint: "SdS.AdvancementItemGrantOptionalHint",
      }),
      spell: new foundry.data.fields.EmbeddedDataField(SpellConfigurationData, {
        required: true,
        nullable: true,
        initial: null,
      }),
    };
  }
}

/**
 * Advancement that automatically grants one or more items to the player. Presents the player with the option of
 * skipping any or all of the items.
 */
class ItemGrantAdvancement extends Advancement$1 {
  /** @inheritdoc */
  static get metadata() {
    return foundry.utils.mergeObject(super.metadata, {
      dataModels: {
        configuration: ItemGrantConfigurationData,
      },
      order: 40,
      icon: "systems/sds/icons/svg/item-grant.svg",
      title: game.i18n.localize("SdS.AdvancementItemGrantTitle"),
      hint: game.i18n.localize("SdS.AdvancementItemGrantHint"),
      apps: {
        config: ItemGrantConfig,
        flow: ItemGrantFlow,
      },
    });
  }

  /* -------------------------------------------- */

  /**
   * The item types that are supported in Item Grant.
   * @type {Set<string>}
   */
  static VALID_TYPES = new Set([
    "feat",
    "spell",
    "consumable",
    "backpack",
    "equipment",
    "loot",
    "tool",
    "weapon",
  ]);

  /* -------------------------------------------- */
  /*  Display Methods                             */
  /* -------------------------------------------- */

  /** @inheritdoc */
  configuredForLevel(level) {
    return !foundry.utils.isEmpty(this.value);
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  summaryForLevel(level, { configMode = false } = {}) {
    // Link to compendium items
    if (!this.value.added || configMode) {
      return this.configuration.items.reduce(
        (html, uuid) => html + sds.utils.linkForUuid(uuid),
        ""
      );
    }

    // Link to items on the actor
    else {
      return Object.keys(this.value.added)
        .map((id) => {
          const item = this.actor.items.get(id);
          return item?.toAnchor({ classes: ["content-link"] }).outerHTML ?? "";
        })
        .join("");
    }
  }

  /* -------------------------------------------- */
  /*  Application Methods                         */
  /* -------------------------------------------- */

  /**
   * Locally apply this advancement to the actor.
   * @param {number} level              Level being advanced.
   * @param {object} data               Data from the advancement form.
   * @param {object} [retainedData={}]  Item data grouped by UUID. If present, this data will be used rather than
   *                                    fetching new data from the source.
   */
  async apply(level, data, retainedData = {}) {
    const items = [];
    const updates = {};
    const spellChanges = this.configuration.spell?.spellChanges ?? {};
    for (const [uuid, selected] of Object.entries(data)) {
      if (!selected) continue;

      let itemData = retainedData[uuid];
      if (!itemData) {
        const source = await fromUuid(uuid);
        if (!source) continue;
        itemData = source
          .clone(
            {
              _id: foundry.utils.randomID(),
              "flags.sds.sourceId": uuid,
              "flags.sds.advancementOrigin": `${this.item.id}.${this.id}`,
            },
            { keepId: true }
          )
          .toObject();
      }
      if (itemData.type === "spell")
        foundry.utils.mergeObject(itemData, spellChanges);

      items.push(itemData);
      updates[itemData._id] = uuid;
    }
    this.actor.updateSource({ items });
    this.updateSource({ "value.added": updates });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  restore(level, data) {
    const updates = {};
    for (const item of data.items) {
      this.actor.updateSource({ items: [item] });
      updates[item._id] = item.flags.sds.sourceId;
    }
    this.updateSource({ "value.added": updates });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  reverse(level) {
    const items = [];
    for (const id of Object.keys(this.value.added ?? {})) {
      const item = this.actor.items.get(id);
      if (item) items.push(item.toObject());
      this.actor.items.delete(id);
    }
    this.updateSource({ "value.-=added": null });
    return { items };
  }
}

/**
 * Data model for the Scale Value advancement type.
 *
 * @property {string} identifier        Identifier used to select this scale value in roll formulas.
 * @property {string} type              Type of data represented by this scale value.
 * @property {object} [distance]
 * @property {string} [distance.units]  If distance type is selected, the units each value uses.
 * @property {Object<string, *>} scale  Scale values for each level. Value format is determined by type.
 */
class ScaleValueConfigurationData extends foundry.abstract.DataModel {
  /** @inheritdoc */
  static defineSchema() {
    return {
      identifier: new IdentifierField({
        required: true,
        label: "SdS.Identifier",
      }),
      type: new foundry.data.fields.StringField({
        required: true,
        initial: "string",
        choices: TYPES,
        label: "SdS.AdvancementScaleValueTypeLabel",
      }),
      distance: new foundry.data.fields.SchemaField({
        units: new foundry.data.fields.StringField({
          required: true,
          label: "SdS.MovementUnits",
        }),
      }),
      scale: new MappingField(new ScaleValueEntryField(), { required: true }),
    };
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static migrateData(source) {
    super.migrateData(source);
    if (source.type === "numeric") source.type = "number";
    Object.values(source.scale ?? {}).forEach((v) =>
      TYPES[source.type].migrateData(v)
    );
  }
}

/**
 * Data field that automatically selects the appropriate ScaleValueType based on the selected type.
 */
class ScaleValueEntryField extends foundry.data.fields.ObjectField {
  /** @override */
  _cleanType(value, options) {
    if (!(typeof value === "object")) value = {};

    // Use a defined DataModel
    const cls = TYPES[options.source?.type];
    if (cls) return cls.cleanData(value, options);

    return value;
  }

  /* -------------------------------------------- */

  /** @override */
  initialize(value, model) {
    const cls = TYPES[model.type];
    if (!value || !cls) return value;
    return new cls(value, { parent: model });
  }

  /* -------------------------------------------- */

  /** @override */
  toObject(value) {
    return value.toObject(false);
  }
}

/**
 * Base scale value data type that stores generic string values.
 *
 * @property {string} value  String value.
 */
class ScaleValueType extends foundry.abstract.DataModel {
  /** @inheritdoc */
  static defineSchema() {
    return {
      value: new foundry.data.fields.StringField({ required: true }),
    };
  }

  /* -------------------------------------------- */

  /**
   * Information on how a scale value of this type is configured.
   *
   * @typedef {object} ScaleValueTypeMetadata
   * @property {string} label       Name of this type.
   * @property {string} hint        Hint for this type shown in the scale value configuration.
   * @property {boolean} isNumeric  When using the default editing interface, should numeric inputs be used?
   */

  /**
   * Configuration information for this scale value type.
   * @type {ScaleValueTypeMetadata}
   */
  static get metadata() {
    return {
      label: "SdS.AdvancementScaleValueTypeString",
      hint: "SdS.AdvancementScaleValueTypeHintString",
      isNumeric: false,
    };
  }

  /* -------------------------------------------- */

  /**
   * Attempt to convert another scale value type to this one.
   * @param {ScaleValueType} original  Original type to attempt to convert.
   * @param {object} [options]         Options which affect DataModel construction.
   * @returns {ScaleValueType|null}
   */
  static convertFrom(original, options) {
    return new this({ value: original.formula }, options);
  }

  /* -------------------------------------------- */

  /**
   * This scale value prepared to be used in roll formulas.
   * @type {string|null}
   */
  get formula() {
    return this.value;
  }

  /* -------------------------------------------- */

  /**
   * This scale value formatted for display.
   * @type {string|null}
   */
  get display() {
    return this.formula;
  }

  /* -------------------------------------------- */

  /**
   * Shortcut to the prepared value when used in roll formulas.
   * @returns {string}
   */
  toString() {
    return this.formula;
  }
}

/**
 * Scale value data type that stores numeric values.
 *
 * @property {number} value  Numeric value.
 */
class ScaleValueTypeNumber extends ScaleValueType {
  /** @inheritdoc */
  static defineSchema() {
    return {
      value: new foundry.data.fields.NumberField({ required: true }),
    };
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static get metadata() {
    return foundry.utils.mergeObject(super.metadata, {
      label: "SdS.AdvancementScaleValueTypeNumber",
      hint: "SdS.AdvancementScaleValueTypeHintNumber",
      isNumeric: true,
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static convertFrom(original, options) {
    const value = Number(original.formula);
    if (Number.isNaN(value)) return null;
    return new this({ value }, options);
  }
}

/**
 * Scale value data type that stores challenge ratings.
 *
 * @property {number} value  CR value.
 */
class ScaleValueTypeCR extends ScaleValueTypeNumber {
  /** @inheritdoc */
  static defineSchema() {
    return {
      value: new foundry.data.fields.NumberField({ required: true, min: 0 }),
      // TODO: Add CR validator
    };
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static get metadata() {
    return foundry.utils.mergeObject(super.metadata, {
      label: "SdS.AdvancementScaleValueTypeCR",
      hint: "SdS.AdvancementScaleValueTypeHintCR",
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  get display() {
    switch (this.value) {
      case 0.125:
        return "&frac18;";
      case 0.25:
        return "&frac14;";
      case 0.5:
        return "&frac12;";
      default:
        return super.display;
    }
  }
}

/**
 * Scale value data type that stores dice values.
 *
 * @property {number} number  Number of dice.
 * @property {number} faces   Die faces.
 */
class ScaleValueTypeDice extends ScaleValueType {
  /** @inheritdoc */
  static defineSchema() {
    return {
      number: new foundry.data.fields.NumberField({
        nullable: true,
        integer: true,
        positive: true,
      }),
      faces: new foundry.data.fields.NumberField({
        required: true,
        integer: true,
        positive: true,
      }),
    };
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static get metadata() {
    return foundry.utils.mergeObject(super.metadata, {
      label: "SdS.AdvancementScaleValueTypeDice",
      hint: "SdS.AdvancementScaleValueTypeHintDice",
    });
  }

  /* -------------------------------------------- */

  /**
   * List of die faces that can be chosen.
   * @type {number[]}
   */
  static FACES = [2, 3, 4, 6, 8, 10, 12, 20, 100];

  /* -------------------------------------------- */

  /** @inheritdoc */
  static convertFrom(original, options) {
    const [number, faces] = (original.formula ?? "").split("d");
    if (!faces || !Number.isNumeric(number) || !Number.isNumeric(faces))
      return null;
    return new this(
      { number: Number(number) || null, faces: Number(faces) },
      options
    );
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  get formula() {
    if (!this.faces) return null;
    return `${this.number ?? ""}${this.die}`;
  }

  /* -------------------------------------------- */

  /**
   * The die value to be rolled with the leading "d" (e.g. "d4").
   * @type {string}
   */
  get die() {
    if (!this.faces) return "";
    return `d${this.faces}`;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static migrateData(source) {
    if (source.n) source.number = source.n;
    if (source.die) source.faces = source.die;
  }
}

/**
 * Scale value data type that stores distance values.
 *
 * @property {number} value  Numeric value.
 */
class ScaleValueTypeDistance extends ScaleValueTypeNumber {
  /** @inheritdoc */
  static get metadata() {
    return foundry.utils.mergeObject(super.metadata, {
      label: "SdS.AdvancementScaleValueTypeDistance",
      hint: "SdS.AdvancementScaleValueTypeHintDistance",
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  get display() {
    return `${this.value} ${
      CONFIG.SdS.movementUnits[
        this.parent.configuration.distance?.units ?? "ft"
      ]
    }`;
  }
}

/**
 * The available types of scaling value.
 * @enum {ScaleValueType}
 */
const TYPES = {
  string: ScaleValueType,
  number: ScaleValueTypeNumber,
  cr: ScaleValueTypeCR,
  dice: ScaleValueTypeDice,
  distance: ScaleValueTypeDistance,
};

var scaleValue = /*#__PURE__*/ Object.freeze({
  __proto__: null,
  ScaleValueConfigurationData: ScaleValueConfigurationData,
  ScaleValueEntryField: ScaleValueEntryField,
  ScaleValueType: ScaleValueType,
  ScaleValueTypeCR: ScaleValueTypeCR,
  ScaleValueTypeDice: ScaleValueTypeDice,
  ScaleValueTypeDistance: ScaleValueTypeDistance,
  ScaleValueTypeNumber: ScaleValueTypeNumber,
  TYPES: TYPES,
});

/**
 * Configuration application for scale values.
 */
class ScaleValueConfig extends AdvancementConfig {
  /** @inheritdoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["sds", "advancement", "scale-value", "two-column"],
      template: "systems/sds/templates/advancement/scale-value-config.hbs",
      width: 540,
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  getData() {
    const config = this.advancement.configuration;
    const type = TYPES[config.type];
    return foundry.utils.mergeObject(super.getData(), {
      classIdentifier: this.item.identifier,
      previewIdentifier:
        config.identifier ||
        this.advancement.title?.slugify() ||
        this.advancement.constructor.metadata.title.slugify(),
      type: type.metadata,
      types: Object.fromEntries(
        Object.entries(TYPES).map(([key, d]) => [
          key,
          game.i18n.localize(d.metadata.label),
        ])
      ),
      faces: Object.fromEntries(
        TYPES.dice.FACES.map((die) => [die, `d${die}`])
      ),
      levels: this._prepareLevelData(),
      movementUnits: CONFIG.SdS.movementUnits,
    });
  }

  /* -------------------------------------------- */

  /**
   * Prepare the data to display at each of the scale levels.
   * @returns {object}
   * @protected
   */
  _prepareLevelData() {
    let lastValue = null;
    return Array.fromRange(CONFIG.SdS.maxLevel + 1)
      .slice(1)
      .reduce((obj, level) => {
        obj[level] = {
          placeholder: this._formatPlaceholder(lastValue),
          value: null,
        };
        const value = this.advancement.configuration.scale[level];
        if (value) {
          this._mergeScaleValues(value, lastValue);
          obj[level].className = "new-scale-value";
          obj[level].value = value;
          lastValue = value;
        }
        return obj;
      }, {});
  }

  /* -------------------------------------------- */

  /**
   * Formats the placeholder for this scale value.
   * @param {*} placeholder
   * @returns {object}
   * @protected
   */
  _formatPlaceholder(placeholder) {
    if (this.advancement.configuration.type === "dice") {
      return {
        number: placeholder?.number ?? "",
        faces: placeholder?.faces ? `d${placeholder.faces}` : "",
      };
    }
    return { value: placeholder?.value ?? "" };
  }

  /* -------------------------------------------- */

  /**
   * For scale values with multiple properties, have missing properties inherit from earlier filled-in values.
   * @param {*} value      The primary value.
   * @param {*} lastValue  The previous value.
   */
  _mergeScaleValues(value, lastValue) {
    for (const k of Object.keys(lastValue ?? {})) {
      if (value[k] == null) value[k] = lastValue[k];
    }
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static _cleanedObject(object) {
    return Object.entries(object).reduce((obj, [key, value]) => {
      if (Object.keys(value ?? {}).some((k) => value[k])) obj[key] = value;
      else obj[`-=${key}`] = null;
      return obj;
    }, {});
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  prepareConfigurationUpdate(configuration) {
    // Ensure multiple values in a row are not the same
    let lastValue = null;
    for (const [lvl, value] of Object.entries(configuration.scale)) {
      if (this.advancement.testEquality(lastValue, value))
        configuration.scale[lvl] = null;
      else if (Object.keys(value ?? {}).some((k) => value[k])) {
        this._mergeScaleValues(value, lastValue);
        lastValue = value;
      }
    }
    configuration.scale = this.constructor._cleanedObject(configuration.scale);
    return configuration;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  activateListeners(html) {
    super.activateListeners(html);
    this.form
      .querySelector("input[name='title']")
      .addEventListener("input", this._onChangeTitle.bind(this));
    this.form
      .querySelector(".identifier-hint-copy")
      .addEventListener("click", this._onIdentifierHintCopy.bind(this));
  }

  /* -------------------------------------------- */

  /**
   * Copies the full scale identifier hint to the clipboard.
   * @param {Event} event  The triggering click event.
   * @protected
   */
  _onIdentifierHintCopy(event) {
    const data = this.getData();
    game.clipboard.copyPlainText(
      `@scale.${data.classIdentifier}.${data.previewIdentifier}`
    );
    game.tooltip.activate(event.target, {
      text: game.i18n.localize("SdS.IdentifierCopied"),
      direction: "UP",
    });
  }

  /* -------------------------------------------- */

  /**
   * If no identifier is manually entered, slugify the custom title and display as placeholder.
   * @param {Event} event  Change event to the title input.
   */
  _onChangeTitle(event) {
    const slug = (
      event.target.value || this.advancement.constructor.metadata.title
    ).slugify();
    this.form.querySelector(
      "input[name='configuration.identifier']"
    ).placeholder = slug;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async _updateObject(event, formData) {
    const updates = foundry.utils.expandObject(formData);
    const typeChange = "configuration.type" in formData;
    if (
      typeChange &&
      updates.configuration.type !== this.advancement.configuration.type
    ) {
      // Clear existing scale value data to prevent error during type update
      await this.advancement.update(
        Array.fromRange(CONFIG.SdS.maxLevel, 1).reduce((obj, lvl) => {
          obj[`configuration.scale.-=${lvl}`] = null;
          return obj;
        }, {})
      );
      updates.configuration.scale ??= {};
      const OriginalType = TYPES[this.advancement.configuration.type];
      const NewType = TYPES[updates.configuration.type];
      for (const [lvl, data] of Object.entries(updates.configuration.scale)) {
        const original = new OriginalType(data, { parent: this.advancement });
        updates.configuration.scale[lvl] =
          NewType.convertFrom(original)?.toObject();
      }
    }
    return super._updateObject(event, foundry.utils.flattenObject(updates));
  }
}

/**
 * Inline application that displays any changes to a scale value.
 */
class ScaleValueFlow extends AdvancementFlow {
  /** @inheritdoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      template: "systems/sds/templates/advancement/scale-value-flow.hbs",
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  getData() {
    return foundry.utils.mergeObject(super.getData(), {
      initial: this.advancement.valueForLevel(this.level - 1)?.display,
      final: this.advancement.valueForLevel(this.level).display,
    });
  }
}

/**
 * Advancement that represents a value that scales with class level. **Can only be added to classes or subclasses.**
 */
class ScaleValueAdvancement extends Advancement$1 {
  /** @inheritdoc */
  static get metadata() {
    return foundry.utils.mergeObject(super.metadata, {
      dataModels: {
        configuration: ScaleValueConfigurationData,
      },
      order: 60,
      icon: "systems/sds/icons/svg/scale-value.svg",
      title: game.i18n.localize("SdS.AdvancementScaleValueTitle"),
      hint: game.i18n.localize("SdS.AdvancementScaleValueHint"),
      multiLevel: true,
      validItemTypes: new Set(["class", "subclass"]),
      apps: {
        config: ScaleValueConfig,
        flow: ScaleValueFlow,
      },
    });
  }

  /* -------------------------------------------- */

  /**
   * The available types of scaling value.
   * @enum {ScaleValueType}
   */
  static TYPES = TYPES;

  /* -------------------------------------------- */
  /*  Instance Properties                         */
  /* -------------------------------------------- */

  /** @inheritdoc */
  get levels() {
    return Array.from(
      Object.keys(this.configuration.scale).map((l) => Number(l))
    );
  }

  /* -------------------------------------------- */

  /**
   * Identifier for this scale value, either manual value or the slugified title.
   * @type {string}
   */
  get identifier() {
    return this.configuration.identifier || this.title.slugify();
  }

  /* -------------------------------------------- */
  /*  Display Methods                             */
  /* -------------------------------------------- */

  /** @inheritdoc */
  titleForLevel(level, { configMode = false } = {}) {
    const value = this.valueForLevel(level)?.display;
    if (!value) return this.title;
    return `${this.title}: <strong>${value}</strong>`;
  }

  /* -------------------------------------------- */

  /**
   * Scale value for the given level.
   * @param {number} level      Level for which to get the scale value.
   * @returns {ScaleValueType}  Scale value at the given level or null if none exists.
   */
  valueForLevel(level) {
    const key = Object.keys(this.configuration.scale)
      .reverse()
      .find((l) => Number(l) <= level);
    const data = this.configuration.scale[key];
    const TypeClass = this.constructor.TYPES[this.configuration.type];
    if (!data || !TypeClass) return null;
    return new TypeClass(data, { parent: this });
  }

  /* -------------------------------------------- */

  /**
   * Compare two scaling values and determine if they are equal.
   * @param {*} a
   * @param {*} b
   * @returns {boolean}
   */
  testEquality(a, b) {
    const keys = Object.keys(a ?? {});
    if (keys.length !== Object.keys(b ?? {}).length) return false;
    for (const k of keys) {
      if (a[k] !== b[k]) return false;
    }
    return true;
  }
}

var _module$a = /*#__PURE__*/ Object.freeze({
  __proto__: null,
  Advancement: Advancement$1,
  HitPointsAdvancement: HitPointsAdvancement,
  ItemGrantAdvancement: ItemGrantAdvancement,
  ScaleValueAdvancement: ScaleValueAdvancement,
});

// Namespace Configuration Values
const SdS = {};

// ASCII Artwork
SdS.ASCII = `_______________________________
______      ______ _____ _____
|  _  \\___  |  _  \\  ___|  ___|
| | | ( _ ) | | | |___ \\| |__
| | | / _ \\/\\ | | |   \\ \\  __|
| |/ / (_>  < |/ //\\__/ / |___
|___/ \\___/\\/___/ \\____/\\____/
_______________________________`;

/**
 * The set of Ability Scores used within the system.
 * @enum {string}
 */
SdS.abilities = {
  str: "SdS.AbilityStr",
  dex: "SdS.AbilityDex",
  con: "SdS.AbilityCon",
  int: "SdS.AbilityInt",
  wis: "SdS.AbilityWis",
  cha: "SdS.AbilityCha",
  hon: "SdS.AbilityHon",
  san: "SdS.AbilitySan",
};
preLocalize("abilities");

/**
 * Localized abbreviations for Ability Scores.
 * @enum {string}
 */
SdS.abilityAbbreviations = {
  str: "SdS.AbilityStrAbbr",
  dex: "SdS.AbilityDexAbbr",
  con: "SdS.AbilityConAbbr",
  int: "SdS.AbilityIntAbbr",
  wis: "SdS.AbilityWisAbbr",
  cha: "SdS.AbilityChaAbbr",
  hon: "SdS.AbilityHonAbbr",
  san: "SdS.AbilitySanAbbr",
};
preLocalize("abilityAbbreviations");

/**
 * Configure which ability score is used as the default modifier for initiative rolls.
 * @type {string}
 */
SdS.initiativeAbility = "dex";

/**
 * Configure which ability score is used when calculating hit points per level.
 * @type {string}
 */
SdS.hitPointsAbility = "con";

/* -------------------------------------------- */

/**
 * Configuration data for skills.
 *
 * @typedef {object} SkillConfiguration
 * @property {string} label    Localized label.
 * @property {string} ability  Key for the default ability used by this skill.
 */

/**
 * The set of skill which can be trained with their default ability scores.
 * @enum {SkillConfiguration}
 */
SdS.skills = {
  acr: { label: "SdS.SkillAcr", ability: "dex" },
  ani: { label: "SdS.SkillAni", ability: "wis" },
  arc: { label: "SdS.SkillArc", ability: "int" },
  ath: { label: "SdS.SkillAth", ability: "str" },
  dec: { label: "SdS.SkillDec", ability: "cha" },
  his: { label: "SdS.SkillHis", ability: "int" },
  ins: { label: "SdS.SkillIns", ability: "wis" },
  itm: { label: "SdS.SkillItm", ability: "cha" },
  inv: { label: "SdS.SkillInv", ability: "int" },
  med: { label: "SdS.SkillMed", ability: "wis" },
  nat: { label: "SdS.SkillNat", ability: "int" },
  prc: { label: "SdS.SkillPrc", ability: "wis" },
  prf: { label: "SdS.SkillPrf", ability: "cha" },
  per: { label: "SdS.SkillPer", ability: "cha" },
  rel: { label: "SdS.SkillRel", ability: "int" },
  slt: { label: "SdS.SkillSlt", ability: "dex" },
  ste: { label: "SdS.SkillSte", ability: "dex" },
  sur: { label: "SdS.SkillSur", ability: "wis" },
};
preLocalize("skills", { key: "label", sort: true });
patchConfig("skills", "label", { since: 2.0, until: 2.2 });

/* -------------------------------------------- */

/**
 * Tag of a spell
 *
 * @typedef {object} SpellTag
 * @property {string} label    Localized label.
 */

/**
 * The set of skill which can be trained with their default ability scores.
 * @enum {SpellTag}
 */
SdS.spell_tags = {
  area: { label: "SdS.SpellTagArea" },
  buff: { label: "SdS.SpellTagBuff" },
  cc: { label: "SdS.SpellTagCC" },
  dmg: { label: "SdS.SpellTagDamage" },
  debuff: { label: "SdS.SpellTagDebuff" },
  def: { label: "SdS.SpellTagDef" },
  detec: { label: "SdS.SpellTagDetection" },
  dist: { label: "SdS.SpellTagDist" },
  explo: { label: "SdS.SpellTagExploration" },
  heal: { label: "SdS.SpellTagHeal" },
  melee: { label: "SdS.SpellTagMelee" },
  social: { label: "SdS.SpellTagSocial" },
  touch: { label: "SdS.SpellTagTouch" },
  util: { label: "SdS.SpellTagUtilities" },
  weapon: { label: "SdS.SpellTagWeapon" },
};
preLocalize("spell_tags", { key: "label", sort: true });

/* -------------------------------------------- */

/**
 * Character alignment options.
 * @enum {string}
 */
SdS.alignments = {
  lg: "SdS.AlignmentLG",
  ng: "SdS.AlignmentNG",
  cg: "SdS.AlignmentCG",
  ln: "SdS.AlignmentLN",
  tn: "SdS.AlignmentTN",
  cn: "SdS.AlignmentCN",
  le: "SdS.AlignmentLE",
  ne: "SdS.AlignmentNE",
  ce: "SdS.AlignmentCE",
};
preLocalize("alignments");

/* -------------------------------------------- */

/**
 * An enumeration of item attunement types.
 * @enum {number}
 */
SdS.attunementTypes = {
  NONE: 0,
  REQUIRED: 1,
  ATTUNED: 2,
};

/**
 * An enumeration of item attunement states.
 * @type {{"0": string, "1": string, "2": string}}
 */
SdS.attunements = {
  0: "SdS.AttunementNone",
  1: "SdS.AttunementRequired",
  2: "SdS.AttunementAttuned",
};
preLocalize("attunements");

/* -------------------------------------------- */

/**
 * General weapon categories.
 * @enum {string}
 */
SdS.weaponProficiencies = {
  sim: "SdS.WeaponSimpleProficiency",
  mar: "SdS.WeaponMartialProficiency",
};
preLocalize("weaponProficiencies");

/**
 * A mapping between `SdS.weaponTypes` and `SdS.weaponProficiencies` that
 * is used to determine if character has proficiency when adding an item.
 * @enum {(boolean|string)}
 */
SdS.weaponProficienciesMap = {
  natural: true,
  simpleM: "sim",
  simpleR: "sim",
  martialM: "mar",
  martialR: "mar",
};

/**
 * The basic weapon types in 5e. This enables specific weapon proficiencies or
 * starting equipment provided by classes and backgrounds.
 * @enum {string}
 */
SdS.weaponIds = {
  battleaxe: "I0WocDSuNpGJayPb",
  blowgun: "wNWK6yJMHG9ANqQV",
  club: "nfIRTECQIG81CvM4",
  dagger: "0E565kQUBmndJ1a2",
  dart: "3rCO8MTIdPGSW6IJ",
  flail: "UrH3sMdnUDckIHJ6",
  glaive: "rOG1OM2ihgPjOvFW",
  greataxe: "1Lxk6kmoRhG8qQ0u",
  greatclub: "QRCsxkCwWNwswL9o",
  greatsword: "xMkP8BmFzElcsMaR",
  halberd: "DMejWAc8r8YvDPP1",
  handaxe: "eO7Fbv5WBk5zvGOc",
  handcrossbow: "qaSro7kFhxD6INbZ",
  heavycrossbow: "RmP0mYRn2J7K26rX",
  javelin: "DWLMnODrnHn8IbAG",
  lance: "RnuxdHUAIgxccVwj",
  lightcrossbow: "ddWvQRLmnnIS0eLF",
  lighthammer: "XVK6TOL4sGItssAE",
  longbow: "3cymOVja8jXbzrdT",
  longsword: "10ZP2Bu3vnCuYMIB",
  mace: "Ajyq6nGwF7FtLhDQ",
  maul: "DizirD7eqjh8n95A",
  morningstar: "dX8AxCh9o0A9CkT3",
  net: "aEiM49V8vWpWw7rU",
  pike: "tC0kcqZT9HHAO0PD",
  quarterstaff: "g2dWN7PQiMRYWzyk",
  rapier: "Tobce1hexTnDk4sV",
  scimitar: "fbC0Mg1a73wdFbqO",
  shortsword: "osLzOwQdPtrK3rQH",
  sickle: "i4NeNZ30ycwPDHMx",
  spear: "OG4nBBydvmfWYXIk",
  shortbow: "GJv6WkD7D2J6rP6M",
  sling: "3gynWO9sN4OLGMWD",
  trident: "F65ANO66ckP8FDMa",
  warpick: "2YdfjN1PIIrSHZii",
  warhammer: "F0Df164Xv1gWcYt0",
  whip: "QKTyxoO0YDnAsbYe",
};

/* -------------------------------------------- */

/**
 * The categories into which Tool items can be grouped.
 *
 * @enum {string}
 */
SdS.toolTypes = {
  art: "SdS.ToolArtisans",
  game: "SdS.ToolGamingSet",
  music: "SdS.ToolMusicalInstrument",
};
preLocalize("toolTypes", { sort: true });

/**
 * The categories of tool proficiencies that a character can gain.
 *
 * @enum {string}
 */
SdS.toolProficiencies = {
  ...SdS.toolTypes,
  vehicle: "SdS.ToolVehicle",
};
preLocalize("toolProficiencies", { sort: true });

/**
 * The basic tool types in 5e. This enables specific tool proficiencies or
 * starting equipment provided by classes and backgrounds.
 * @enum {string}
 */
SdS.toolIds = {
  alchemist: "SztwZhbhZeCqyAes",
  bagpipes: "yxHi57T5mmVt0oDr",
  brewer: "Y9S75go1hLMXUD48",
  calligrapher: "jhjo20QoiD5exf09",
  card: "YwlHI3BVJapz4a3E",
  carpenter: "8NS6MSOdXtUqD7Ib",
  cartographer: "fC0lFK8P4RuhpfaU",
  chess: "23y8FvWKf9YLcnBL",
  cobbler: "hM84pZnpCqKfi8XH",
  cook: "Gflnp29aEv5Lc1ZM",
  dice: "iBuTM09KD9IoM5L8",
  disg: "IBhDAr7WkhWPYLVn",
  drum: "69Dpr25pf4BjkHKb",
  dulcimer: "NtdDkjmpdIMiX7I2",
  flute: "eJOrPcAz9EcquyRQ",
  forg: "cG3m4YlHfbQlLEOx",
  glassblower: "rTbVrNcwApnuTz5E",
  herb: "i89okN7GFTWHsvPy",
  horn: "aa9KuBy4dst7WIW9",
  jeweler: "YfBwELTgPFHmQdHh",
  leatherworker: "PUMfwyVUbtyxgYbD",
  lute: "qBydtUUIkv520DT7",
  lyre: "EwG1EtmbgR3bM68U",
  mason: "skUih6tBvcBbORzA",
  navg: "YHCmjsiXxZ9UdUhU",
  painter: "ccm5xlWhx74d6lsK",
  panflute: "G5m5gYIx9VAUWC3J",
  pois: "il2GNi8C0DvGLL9P",
  potter: "hJS8yEVkqgJjwfWa",
  shawm: "G3cqbejJpfB91VhP",
  smith: "KndVe2insuctjIaj",
  thief: "woWZ1sO5IUVGzo58",
  tinker: "0d08g1i5WXnNrCNA",
  viol: "baoe3U5BfMMMxhCU",
  weaver: "ap9prThUB2y9lDyj",
  woodcarver: "xKErqkLo4ASYr5EP",
};

/* -------------------------------------------- */

/**
 * The various lengths of time over which effects can occur.
 * @enum {string}
 */
SdS.timePeriods = {
  inst: "SdS.TimeInst",
  turn: "SdS.TimeTurn",
  round: "SdS.TimeRound",
  minute: "SdS.TimeMinute",
  hour: "SdS.TimeHour",
  day: "SdS.TimeDay",
  month: "SdS.TimeMonth",
  year: "SdS.TimeYear",
  perm: "SdS.TimePerm",
  spec: "SdS.Special",
};
preLocalize("timePeriods");

/* -------------------------------------------- */

/**
 * Various ways in which an item or ability can be activated.
 * @enum {string}
 */
SdS.abilityActivationTypes = {
  action: "SdS.Action",
  bonus: "SdS.BonusAction",
  reaction: "SdS.Reaction",
  minute: SdS.timePeriods.minute,
  hour: SdS.timePeriods.hour,
  day: SdS.timePeriods.day,
  special: SdS.timePeriods.spec,
  legendary: "SdS.LegendaryActionLabel",
  lair: "SdS.LairActionLabel",
  crew: "SdS.VehicleCrewAction",
};
preLocalize("abilityActivationTypes");

/* -------------------------------------------- */

/**
 * Different things that an ability can consume upon use.
 * @enum {string}
 */
SdS.abilityConsumptionTypes = {
  ammo: "SdS.ConsumeAmmunition",
  attribute: "SdS.ConsumeAttribute",
  hitDice: "SdS.ConsumeHitDice",
  material: "SdS.ConsumeMaterial",
  charges: "SdS.ConsumeCharges",
};
preLocalize("abilityConsumptionTypes", { sort: true });

/* -------------------------------------------- */

/**
 * Creature sizes.
 * @enum {string}
 */
SdS.actorSizes = {
  tiny: "SdS.SizeTiny",
  sm: "SdS.SizeSmall",
  med: "SdS.SizeMedium",
  lg: "SdS.SizeLarge",
  huge: "SdS.SizeHuge",
  grg: "SdS.SizeGargantuan",
};
preLocalize("actorSizes");

/**
 * Default token image size for the values of `SdS.actorSizes`.
 * @enum {number}
 */
SdS.tokenSizes = {
  tiny: 0.5,
  sm: 1,
  med: 1,
  lg: 2,
  huge: 3,
  grg: 4,
};

/**
 * Colors used to visualize temporary and temporary maximum HP in token health bars.
 * @enum {number}
 */
SdS.tokenHPColors = {
  damage: 0xff0000,
  healing: 0x00ff00,
  temp: 0x66ccff,
  tempmax: 0x440066,
  negmax: 0x550000,
};

/* -------------------------------------------- */

/**
 * Default types of creatures.
 * *Note: Not pre-localized to allow for easy fetching of pluralized forms.*
 * @enum {string}
 */
SdS.creatureTypes = {
  aberration: "SdS.CreatureAberration",
  beast: "SdS.CreatureBeast",
  celestial: "SdS.CreatureCelestial",
  construct: "SdS.CreatureConstruct",
  dragon: "SdS.CreatureDragon",
  elemental: "SdS.CreatureElemental",
  fey: "SdS.CreatureFey",
  fiend: "SdS.CreatureFiend",
  giant: "SdS.CreatureGiant",
  humanoid: "SdS.CreatureHumanoid",
  monstrosity: "SdS.CreatureMonstrosity",
  ooze: "SdS.CreatureOoze",
  plant: "SdS.CreaturePlant",
  undead: "SdS.CreatureUndead",
};

/* -------------------------------------------- */

/**
 * Classification types for item action types.
 * @enum {string}
 */
SdS.itemActionTypes = {
  mwak: "SdS.ActionMWAK",
  rwak: "SdS.ActionRWAK",
  msak: "SdS.ActionMSAK",
  rsak: "SdS.ActionRSAK",
  save: "SdS.ActionSave",
  heal: "SdS.ActionHeal",
  abil: "SdS.ActionAbil",
  util: "SdS.ActionUtil",
  other: "SdS.ActionOther",
};
preLocalize("itemActionTypes");

/* -------------------------------------------- */

/**
 * Different ways in which item capacity can be limited.
 * @enum {string}
 */
SdS.itemCapacityTypes = {
  items: "SdS.ItemContainerCapacityItems",
  weight: "SdS.ItemContainerCapacityWeight",
};
preLocalize("itemCapacityTypes", { sort: true });

/* -------------------------------------------- */

/**
 * List of various item rarities.
 * @enum {string}
 */
SdS.itemRarity = {
  common: "SdS.ItemRarityCommon",
  uncommon: "SdS.ItemRarityUncommon",
  rare: "SdS.ItemRarityRare",
  veryRare: "SdS.ItemRarityVeryRare",
  legendary: "SdS.ItemRarityLegendary",
  artifact: "SdS.ItemRarityArtifact",
};
preLocalize("itemRarity");

/* -------------------------------------------- */

/**
 * Enumerate the lengths of time over which an item can have limited use ability.
 * @enum {string}
 */
SdS.limitedUsePeriods = {
  sr: "SdS.ShortRest",
  lr: "SdS.LongRest",
  day: "SdS.Day",
  charges: "SdS.Charges",
};
preLocalize("limitedUsePeriods");

/* -------------------------------------------- */

/**
 * Specific equipment types that modify base AC.
 * @enum {string}
 */
SdS.armorTypes = {
  light: "SdS.EquipmentLight",
  medium: "SdS.EquipmentMedium",
  heavy: "SdS.EquipmentHeavy",
  natural: "SdS.EquipmentNatural",
  shield: "SdS.EquipmentShield",
};
preLocalize("armorTypes");

/* -------------------------------------------- */

/**
 * Equipment types that aren't armor.
 * @enum {string}
 */
SdS.miscEquipmentTypes = {
  clothing: "SdS.EquipmentClothing",
  trinket: "SdS.EquipmentTrinket",
  vehicle: "SdS.EquipmentVehicle",
};
preLocalize("miscEquipmentTypes", { sort: true });

/* -------------------------------------------- */

/**
 * The set of equipment types for armor, clothing, and other objects which can be worn by the character.
 * @enum {string}
 */
SdS.equipmentTypes = {
  ...SdS.miscEquipmentTypes,
  ...SdS.armorTypes,
};
preLocalize("equipmentTypes", { sort: true });

/* -------------------------------------------- */

/**
 * The various types of vehicles in which characters can be proficient.
 * @enum {string}
 */
SdS.vehicleTypes = {
  air: "SdS.VehicleTypeAir",
  land: "SdS.VehicleTypeLand",
  space: "SdS.VehicleTypeSpace",
  water: "SdS.VehicleTypeWater",
};
preLocalize("vehicleTypes", { sort: true });

/* -------------------------------------------- */

/**
 * The set of Armor Proficiencies which a character may have.
 * @type {object}
 */
SdS.armorProficiencies = {
  lgt: SdS.equipmentTypes.light,
  med: SdS.equipmentTypes.medium,
  hvy: SdS.equipmentTypes.heavy,
  shl: "SdS.EquipmentShieldProficiency",
};
preLocalize("armorProficiencies");

/**
 * A mapping between `SdS.equipmentTypes` and `SdS.armorProficiencies` that
 * is used to determine if character has proficiency when adding an item.
 * @enum {(boolean|string)}
 */
SdS.armorProficienciesMap = {
  natural: true,
  clothing: true,
  light: "lgt",
  medium: "med",
  heavy: "hvy",
  shield: "shl",
};

/**
 * The basic armor types in 5e. This enables specific armor proficiencies,
 * automated AC calculation in NPCs, and starting equipment.
 * @enum {string}
 */
SdS.armorIds = {
  breastplate: "SK2HATQ4abKUlV8i",
  chainmail: "rLMflzmxpe8JGTOA",
  chainshirt: "p2zChy24ZJdVqMSH",
  halfplate: "vsgmACFYINloIdPm",
  hide: "n1V07puo0RQxPGuF",
  leather: "WwdpHLXGX5r8uZu5",
  padded: "GtKV1b5uqFQqpEni",
  plate: "OjkIqlW2UpgFcjZa",
  ringmail: "nsXZejlmgalj4he9",
  scalemail: "XmnlF5fgIO3tg6TG",
  splint: "cKpJmsJmU8YaiuqG",
  studded: "TIV3B1vbrVHIhQAm",
};

/**
 * The basic shield in 5e.
 * @enum {string}
 */
SdS.shieldIds = {
  shield: "sSs3hSzkKBMNBgTs",
};

/**
 * Common armor class calculations.
 * @enum {{ label: string, [formula]: string }}
 */
SdS.armorClasses = {
  flat: {
    label: "SdS.ArmorClassFlat",
    formula: "@attributes.ac.flat",
  },
  natural: {
    label: "SdS.ArmorClassNatural",
    formula: "@attributes.ac.flat",
  },
  default: {
    label: "SdS.ArmorClassEquipment",
    formula: "@attributes.ac.armor + @attributes.ac.dex",
  },
  mage: {
    label: "SdS.ArmorClassMage",
    formula: "13 + @abilities.dex.mod",
  },
  draconic: {
    label: "SdS.ArmorClassDraconic",
    formula: "13 + @abilities.dex.mod",
  },
  unarmoredMonk: {
    label: "SdS.ArmorClassUnarmoredMonk",
    formula: "10 + @abilities.dex.mod + @abilities.wis.mod",
  },
  unarmoredBarb: {
    label: "SdS.ArmorClassUnarmoredBarbarian",
    formula: "10 + @abilities.dex.mod + @abilities.con.mod",
  },
  custom: {
    label: "SdS.ArmorClassCustom",
  },
};
preLocalize("armorClasses", { key: "label" });

/* -------------------------------------------- */

/**
 * Enumerate the valid consumable types which are recognized by the system.
 * @enum {string}
 */
SdS.consumableTypes = {
  ammo: "SdS.ConsumableAmmo",
  potion: "SdS.ConsumablePotion",
  poison: "SdS.ConsumablePoison",
  food: "SdS.ConsumableFood",
  scroll: "SdS.ConsumableScroll",
  wand: "SdS.ConsumableWand",
  rod: "SdS.ConsumableRod",
  trinket: "SdS.ConsumableTrinket",
};
preLocalize("consumableTypes", { sort: true });

/* -------------------------------------------- */

/**
 * Configuration data for an item with the "feature" type.
 *
 * @typedef {object} FeatureTypeConfiguration
 * @property {string} label                       Localized label for this type.
 * @property {Object<string, string>} [subtypes]  Enum containing localized labels for subtypes.
 */

/**
 * Types of "features" items.
 * @enum {FeatureTypeConfiguration}
 */
SdS.featureTypes = {
  background: {
    label: "SdS.Feature.Background",
  },
  class: {
    label: "SdS.Feature.Class",
    subtypes: {
      artificerInfusion: "SdS.ClassFeature.ArtificerInfusion",
      channelDivinity: "SdS.ClassFeature.ChannelDivinity",
      defensiveTactic: "SdS.ClassFeature.DefensiveTactic",
      eldritchInvocation: "SdS.ClassFeature.EldritchInvocation",
      elementalDiscipline: "SdS.ClassFeature.ElementalDiscipline",
      fightingStyle: "SdS.ClassFeature.FightingStyle",
      huntersPrey: "SdS.ClassFeature.HuntersPrey",
      ki: "SdS.ClassFeature.Ki",
      maneuver: "SdS.ClassFeature.Maneuver",
      metamagic: "SdS.ClassFeature.Metamagic",
      multiattack: "SdS.ClassFeature.Multiattack",
      pact: "SdS.ClassFeature.PactBoon",
      psionicPower: "SdS.ClassFeature.PsionicPower",
      rune: "SdS.ClassFeature.Rune",
      superiorHuntersDefense: "SdS.ClassFeature.SuperiorHuntersDefense",
    },
  },
  monster: {
    label: "SdS.Feature.Monster",
  },
  race: {
    label: "SdS.Feature.Race",
  },
  feat: {
    label: "SdS.Feature.Feat",
  },
};
preLocalize("featureTypes", { key: "label" });
preLocalize("featureTypes.class.subtypes", { sort: true });

/* -------------------------------------------- */

/**
 * @typedef {object} CurrencyConfiguration
 * @property {string} label         Localized label for the currency.
 * @property {string} abbreviation  Localized abbreviation for the currency.
 * @property {number} conversion    Number by which this currency should be multiplied to arrive at a standard value.
 */

/**
 * The valid currency denominations with localized labels, abbreviations, and conversions.
 * The conversion number defines how many of that currency are equal to one GP.
 * @enum {CurrencyConfiguration}
 */
SdS.currencies = {
  pp: {
    label: "SdS.CurrencyPP",
    abbreviation: "SdS.CurrencyAbbrPP",
    conversion: 0.1,
  },
  gp: {
    label: "SdS.CurrencyGP",
    abbreviation: "SdS.CurrencyAbbrGP",
    conversion: 1,
  },
  ep: {
    label: "SdS.CurrencyEP",
    abbreviation: "SdS.CurrencyAbbrEP",
    conversion: 2,
  },
  sp: {
    label: "SdS.CurrencySP",
    abbreviation: "SdS.CurrencyAbbrSP",
    conversion: 10,
  },
  cp: {
    label: "SdS.CurrencyCP",
    abbreviation: "SdS.CurrencyAbbrCP",
    conversion: 100,
  },
};
preLocalize("currencies", { keys: ["label", "abbreviation"] });

/* -------------------------------------------- */
/*  Damage Types                                */
/* -------------------------------------------- */

/**
 * Types of damage that are considered physical.
 * @enum {string}
 */
SdS.physicalDamageTypes = {
  bludgeoning: "SdS.DamageBludgeoning",
  piercing: "SdS.DamagePiercing",
  slashing: "SdS.DamageSlashing",
};
preLocalize("physicalDamageTypes", { sort: true });

/* -------------------------------------------- */

/**
 * Types of damage the can be caused by abilities.
 * @enum {string}
 */
SdS.damageTypes = {
  ...SdS.physicalDamageTypes,
  acid: "SdS.DamageAcid",
  cold: "SdS.DamageCold",
  fire: "SdS.DamageFire",
  force: "SdS.DamageForce",
  lightning: "SdS.DamageLightning",
  necrotic: "SdS.DamageNecrotic",
  poison: "SdS.DamagePoison",
  psychic: "SdS.DamagePsychic",
  radiant: "SdS.DamageRadiant",
  thunder: "SdS.DamageThunder",
};
preLocalize("damageTypes", { sort: true });

/* -------------------------------------------- */

/**
 * Types of damage to which an actor can possess resistance, immunity, or vulnerability.
 * @enum {string}
 * @deprecated
 */
SdS.damageResistanceTypes = {
  ...SdS.damageTypes,
  physical: "SdS.DamagePhysical",
};
preLocalize("damageResistanceTypes", { sort: true });

/* -------------------------------------------- */
/*  Movement                                    */
/* -------------------------------------------- */

/**
 * Different types of healing that can be applied using abilities.
 * @enum {string}
 */
SdS.healingTypes = {
  healing: "SdS.Healing",
  temphp: "SdS.HealingTemp",
};
preLocalize("healingTypes");

/* -------------------------------------------- */

/**
 * The valid units of measure for movement distances in the game system.
 * By default this uses the imperial units of feet and miles.
 * @enum {string}
 */
SdS.movementTypes = {
  burrow: "SdS.MovementBurrow",
  climb: "SdS.MovementClimb",
  fly: "SdS.MovementFly",
  swim: "SdS.MovementSwim",
  walk: "SdS.MovementWalk",
};
preLocalize("movementTypes", { sort: true });

/* -------------------------------------------- */
/*  Measurement                                 */
/* -------------------------------------------- */

/**
 * The valid units of measure for movement distances in the game system.
 * By default this uses the imperial units of feet and miles.
 * @enum {string}
 */
SdS.movementUnits = {
  ft: "SdS.DistFt",
  mi: "SdS.DistMi",
  m: "SdS.DistM",
  km: "SdS.DistKm",
};
preLocalize("movementUnits");

/* -------------------------------------------- */

/**
 * The types of range that are used for measuring actions and effects.
 * @enum {string}
 */
SdS.rangeTypes = {
  self: "SdS.DistSelf",
  touch: "SdS.DistTouch",
  spec: "SdS.Special",
  any: "SdS.DistAny",
};
preLocalize("rangeTypes");

/* -------------------------------------------- */

/**
 * The valid units of measure for the range of an action or effect. A combination of `SdS.movementUnits` and
 * `SdS.rangeUnits`.
 * @enum {string}
 */
SdS.distanceUnits = {
  ...SdS.movementUnits,
  ...SdS.rangeTypes,
};
preLocalize("distanceUnits");

/* -------------------------------------------- */

/**
 * Configure aspects of encumbrance calculation so that it could be configured by modules.
 * @enum {{ imperial: number, metric: number }}
 */
SdS.encumbrance = {
  currencyPerWeight: {
    imperial: 50,
    metric: 110,
  },
  strMultiplier: {
    imperial: 15,
    metric: 6.8,
  },
  vehicleWeightMultiplier: {
    imperial: 2000, // 2000 lbs in an imperial ton
    metric: 1000, // 1000 kg in a metric ton
  },
};

/* -------------------------------------------- */
/*  Targeting                                   */
/* -------------------------------------------- */

/**
 * Targeting types that apply to one or more distinct targets.
 * @enum {string}
 */
SdS.individualTargetTypes = {
  self: "SdS.TargetSelf",
  ally: "SdS.TargetAlly",
  enemy: "SdS.TargetEnemy",
  creature: "SdS.TargetCreature",
  object: "SdS.TargetObject",
  space: "SdS.TargetSpace",
};
preLocalize("individualTargetTypes");

/* -------------------------------------------- */

/**
 * Information needed to represent different area of effect target types.
 *
 * @typedef {object} AreaTargetDefinition
 * @property {string} label     Localized label for this type.
 * @property {string} template  Type of `MeasuredTemplate` create for this target type.
 */

/**
 * Targeting types that cover an area.
 * @enum {AreaTargetDefinition}
 */
SdS.areaTargetTypes = {
  radius: {
    label: "SdS.TargetRadius",
    template: "circle",
  },
  sphere: {
    label: "SdS.TargetSphere",
    template: "circle",
  },
  cylinder: {
    label: "SdS.TargetCylinder",
    template: "circle",
  },
  cone: {
    label: "SdS.TargetCone",
    template: "cone",
  },
  square: {
    label: "SdS.TargetSquare",
    template: "rect",
  },
  cube: {
    label: "SdS.TargetCube",
    template: "rect",
  },
  line: {
    label: "SdS.TargetLine",
    template: "ray",
  },
  wall: {
    label: "SdS.TargetWall",
    template: "ray",
  },
};
preLocalize("areaTargetTypes", { key: "label", sort: true });
patchConfig("areaTargetTypes", "template", { since: 2.0, until: 2.2 });

/* -------------------------------------------- */

/**
 * The types of single or area targets which can be applied to abilities.
 * @enum {string}
 */
SdS.targetTypes = {
  ...SdS.individualTargetTypes,
  ...Object.fromEntries(
    Object.entries(SdS.areaTargetTypes).map(([k, v]) => [k, v.label])
  ),
};
preLocalize("targetTypes", { sort: true });

/* -------------------------------------------- */

/**
 * Denominations of hit dice which can apply to classes.
 * @type {string[]}
 */
SdS.hitDieTypes = ["d4", "d6", "d8", "d10", "d12"];

/* -------------------------------------------- */

/**
 * The set of possible sensory perception types which an Actor may have.
 * @enum {string}
 */
SdS.senses = {
  blindsight: "SdS.SenseBlindsight",
  darkvision: "SdS.SenseDarkvision",
  tremorsense: "SdS.SenseTremorsense",
  truesight: "SdS.SenseTruesight",
};
preLocalize("senses", { sort: true });

/* -------------------------------------------- */
/*  Spellcasting                                */
/* -------------------------------------------- */

/**
 * Define the standard slot progression by character level.
 * The entries of this array represent the spell slot progression for a full spell-caster.
 * @type {number[][]}
 */
SdS.SPELL_SLOT_TABLE = [
  [2],
  [3],
  [4, 2],
  [4, 3],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 2],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

/* -------------------------------------------- */

/**
 * Define the standard mana per level.
 */
SdS.MANA_PER_LEVEL = {
  1: 500,
  2: 800,
  3: 1600,
  4: 2000,
  5: 4000,
  6: 4800,
  7: 9000,
  8: 10_000,
  9: 20_000,
  10: 24_000,
  11: 45_000,
  12: 50_000,
  13: 100_000,
  14: 120_000,
  15: 240_000,
  16: 280_000,
  17: 550_000,
  18: 750_000,
  19: 1_400_000,
  20: 2_000_000,
};

/* -------------------------------------------- */

/**
 * Various different ways a spell can be prepared.
 */
SdS.spellPreparationModes = {
  prepared: "SdS.SpellPrepPrepared",
  pact: "SdS.PactMagic",
  always: "SdS.SpellPrepAlways",
  atwill: "SdS.SpellPrepAtWill",
  innate: "SdS.SpellPrepInnate",
};
preLocalize("spellPreparationModes");

/* -------------------------------------------- */

/**
 * Subset of `SdS.spellPreparationModes` that consume spell slots.
 * @type {boolean[]}
 */
SdS.spellUpcastModes = ["always", "pact", "prepared"];

/* -------------------------------------------- */

/**
 * Configuration data for different types of spellcasting supported.
 *
 * @typedef {object} SpellcastingTypeConfiguration
 * @property {string} label                                                        Localized label.
 * @property {Object<string, SpellcastingProgressionConfiguration>} [progression]  Any progression modes for this type.
 */

/**
 * Configuration data for a spellcasting progression mode.
 *
 * @typedef {object} SpellcastingProgressionConfiguration
 * @property {string} label             Localized label.
 * @property {number} [divisor=1]       Value by which the class levels are divided to determine spellcasting level.
 * @property {boolean} [roundUp=false]  Should fractional values should be rounded up by default?
 */

/**
 * Different spellcasting types and their progression.
 * @type {SpellcastingTypeConfiguration}
 */
SdS.spellcastingTypes = {
  leveled: {
    label: "SdS.SpellProgLeveled",
    progression: {
      full: {
        label: "SdS.SpellProgFull",
        divisor: 1,
      },
      half: {
        label: "SdS.SpellProgHalf",
        divisor: 2,
      },
      third: {
        label: "SdS.SpellProgThird",
        divisor: 3,
      },
      artificer: {
        label: "SdS.SpellProgArt",
        divisor: 2,
        roundUp: true,
      },
    },
  },
  pact: {
    label: "SdS.SpellProgPact",
  },
};
preLocalize("spellcastingTypes", { key: "label", sort: true });
preLocalize("spellcastingTypes.leveled.progression", { key: "label" });

/* -------------------------------------------- */

/**
 * Ways in which a class can contribute to spellcasting levels.
 * @enum {string}
 */
SdS.spellProgression = {
  none: "SdS.SpellNone",
  full: "SdS.SpellProgFull",
  half: "SdS.SpellProgHalf",
  third: "SdS.SpellProgThird",
  pact: "SdS.SpellProgPact",
  artificer: "SdS.SpellProgArt",
};
preLocalize("spellProgression", { key: "label" });

/* -------------------------------------------- */

/**
 * Valid spell levels.
 * @enum {string}
 */
SdS.spellLevels = {
  0: "SdS.SpellLevel0",
  1: "SdS.SpellLevel1",
  2: "SdS.SpellLevel2",
  3: "SdS.SpellLevel3",
  4: "SdS.SpellLevel4",
  5: "SdS.SpellLevel5",
  6: "SdS.SpellLevel6",
  7: "SdS.SpellLevel7",
  8: "SdS.SpellLevel8",
  9: "SdS.SpellLevel9",
};
preLocalize("spellLevels");

/* -------------------------------------------- */

/**
 * The available choices for how spell damage scaling may be computed.
 * @enum {string}
 */
SdS.spellScalingModes = {
  none: "SdS.SpellNone",
  cantrip: "SdS.SpellCantrip",
  level: "SdS.SpellLevel",
};
preLocalize("spellScalingModes", { sort: true });

/* -------------------------------------------- */

/**
 * Types of components that can be required when casting a spell.
 * @enum {object}
 */
SdS.spellComponents = {
  vocal: {
    label: "SdS.ComponentVerbal",
    abbr: "SdS.ComponentVerbalAbbr",
  },
  somatic: {
    label: "SdS.ComponentSomatic",
    abbr: "SdS.ComponentSomaticAbbr",
  },
  material: {
    label: "SdS.ComponentMaterial",
    abbr: "SdS.ComponentMaterialAbbr",
  },
};
preLocalize("spellComponents", { keys: ["label", "abbr"] });

/* -------------------------------------------- */

/**
 * Supplementary rules keywords that inform a spell's use.
 * @enum {object}
 */
SdS.spellTags = {
  concentration: {
    label: "SdS.Concentration",
    abbr: "SdS.ConcentrationAbbr",
  },
  ritual: {
    label: "SdS.Ritual",
    abbr: "SdS.RitualAbbr",
  },
};
preLocalize("spellTags", { keys: ["label", "abbr"] });

/* -------------------------------------------- */

/**
 * Schools to which a spell can belong.
 * @enum {string}
 */
SdS.spellSchools = {
  elem: "SdS.SchoolElem",
  esp: "SdS.SchoolEsp",
  music: "SdS.SchoolMusic",
  nec: "SdS.SchoolNec",
  ilu: "SdS.SchoolIlu",
  inv: "SdS.SchoolInv",
  psy: "SdS.SchoolPsy",
  pur: "SdS.SchoolPur",
};
preLocalize("spellSchools", { sort: true });

/* -------------------------------------------- */

/**
 * Elements to which an elemental spell can belong.
 * @enum {string}
 */
SdS.spellElements = {
  air: "SdS.ElementAir",
  fire: "SdS.ElementFir",
  shadow: "SdS.ElementSha",
  light: "SdS.ElementLight",
  lightning: "SdS.ElementLig",
  metal: "SdS.ElementMet",
  poison: "SdS.ElementPoi",
  rock: "SdS.ElementRoc",
  water: "SdS.ElementWat",
};
preLocalize("spellElements", { sort: true });

/* -------------------------------------------- */

/**
 * Elements to which an elemental spell can belong.
 * @enum {string}
 */
SdS.spellClasses = {
  archer: "SdS.ClassArcher",
  bard: "SdS.ClassBard",
  fighter: "SdS.ClassFighter",
  mage: "SdS.ClassMage",
  monk: "SdS.ClassMonk",
  rogue: "SdS.ClassRogue",
  shaman: "SdS.ClassShaman",
};
preLocalize("spellClasses", { sort: true });

/* -------------------------------------------- */

/**
 * Spell scroll item ID within the `SdS.sourcePacks` compendium for each level.
 * @enum {string}
 */
SdS.spellScrollIds = {
  0: "rQ6sO7HDWzqMhSI3",
  1: "9GSfMg0VOA2b4uFN",
  2: "XdDp6CKh9qEvPTuS",
  3: "hqVKZie7x9w3Kqds",
  4: "DM7hzgL836ZyUFB1",
  5: "wa1VF8TXHmkrrR35",
  6: "tI3rWx4bxefNCexS",
  7: "mtyw4NS1s7j2EJaD",
  8: "aOrinPg7yuDZEuWr",
  9: "O4YbkJkLlnsgUszZ",
};

/* -------------------------------------------- */
/*  Weapon Details                              */
/* -------------------------------------------- */

/**
 * The set of types which a weapon item can take.
 * @enum {string}
 */
SdS.weaponTypes = {
  simpleM: "SdS.WeaponSimpleM",
  simpleR: "SdS.WeaponSimpleR",
  martialM: "SdS.WeaponMartialM",
  martialR: "SdS.WeaponMartialR",
  natural: "SdS.WeaponNatural",
  improv: "SdS.WeaponImprov",
  siege: "SdS.WeaponSiege",
};
preLocalize("weaponTypes");

/* -------------------------------------------- */

/**
 * A subset of weapon properties that determine the physical characteristics of the weapon.
 * These properties are used for determining physical resistance bypasses.
 * @enum {string}
 */
SdS.physicalWeaponProperties = {
  ada: "SdS.WeaponPropertiesAda",
  mgc: "SdS.WeaponPropertiesMgc",
  sil: "SdS.WeaponPropertiesSil",
};
preLocalize("physicalWeaponProperties", { sort: true });

/* -------------------------------------------- */

/**
 * The set of weapon property flags which can exist on a weapon.
 * @enum {string}
 */
SdS.weaponProperties = {
  ...SdS.physicalWeaponProperties,
  amm: "SdS.WeaponPropertiesAmm",
  fin: "SdS.WeaponPropertiesFin",
  fir: "SdS.WeaponPropertiesFir",
  foc: "SdS.WeaponPropertiesFoc",
  hvy: "SdS.WeaponPropertiesHvy",
  lgt: "SdS.WeaponPropertiesLgt",
  lod: "SdS.WeaponPropertiesLod",
  rch: "SdS.WeaponPropertiesRch",
  rel: "SdS.WeaponPropertiesRel",
  ret: "SdS.WeaponPropertiesRet",
  spc: "SdS.WeaponPropertiesSpc",
  thr: "SdS.WeaponPropertiesThr",
  two: "SdS.WeaponPropertiesTwo",
  ver: "SdS.WeaponPropertiesVer",
};
preLocalize("weaponProperties", { sort: true });

/* -------------------------------------------- */

/**
 * Compendium packs used for localized items.
 * @enum {string}
 */
SdS.sourcePacks = {
  ITEMS: "sds.items",
};

/* -------------------------------------------- */

/**
 * Settings to configure how actors are merged when polymorphing is applied.
 * @enum {string}
 */
SdS.polymorphSettings = {
  keepPhysical: "SdS.PolymorphKeepPhysical",
  keepMental: "SdS.PolymorphKeepMental",
  keepSaves: "SdS.PolymorphKeepSaves",
  keepSkills: "SdS.PolymorphKeepSkills",
  mergeSaves: "SdS.PolymorphMergeSaves",
  mergeSkills: "SdS.PolymorphMergeSkills",
  keepClass: "SdS.PolymorphKeepClass",
  keepFeats: "SdS.PolymorphKeepFeats",
  keepSpells: "SdS.PolymorphKeepSpells",
  keepItems: "SdS.PolymorphKeepItems",
  keepBio: "SdS.PolymorphKeepBio",
  keepVision: "SdS.PolymorphKeepVision",
  keepSelf: "SdS.PolymorphKeepSelf",
};
preLocalize("polymorphSettings", { sort: true });

/**
 * Settings to configure how actors are effects are merged when polymorphing is applied.
 * @enum {string}
 */
SdS.polymorphEffectSettings = {
  keepAE: "SdS.PolymorphKeepAE",
  keepOtherOriginAE: "SdS.PolymorphKeepOtherOriginAE",
  keepOriginAE: "SdS.PolymorphKeepOriginAE",
  keepEquipmentAE: "SdS.PolymorphKeepEquipmentAE",
  keepFeatAE: "SdS.PolymorphKeepFeatureAE",
  keepSpellAE: "SdS.PolymorphKeepSpellAE",
  keepClassAE: "SdS.PolymorphKeepClassAE",
  keepBackgroundAE: "SdS.PolymorphKeepBackgroundAE",
};
preLocalize("polymorphEffectSettings", { sort: true });

/**
 * Settings to configure how actors are merged when preset polymorphing is applied.
 * @enum {object}
 */
SdS.transformationPresets = {
  wildshape: {
    icon: '<i class="fas fa-paw"></i>',
    label: "SdS.PolymorphWildShape",
    options: {
      keepBio: true,
      keepClass: true,
      keepMental: true,
      mergeSaves: true,
      mergeSkills: true,
      keepEquipmentAE: false,
    },
  },
  polymorph: {
    icon: '<i class="fas fa-pastafarianism"></i>',
    label: "SdS.Polymorph",
    options: {
      keepEquipmentAE: false,
      keepClassAE: false,
      keepFeatAE: false,
      keepBackgroundAE: false,
    },
  },
  polymorphSelf: {
    icon: '<i class="fas fa-eye"></i>',
    label: "SdS.PolymorphSelf",
    options: {
      keepSelf: true,
    },
  },
};
preLocalize("transformationPresets", { sort: true, keys: ["label"] });

/* -------------------------------------------- */

/**
 * Skill, ability, and tool proficiency levels.
 * The key for each level represents its proficiency multiplier.
 * @enum {string}
 */
SdS.proficiencyLevels = {
  0: "SdS.NotProficient",
  1: "SdS.Proficient",
  0.5: "SdS.HalfProficient",
  2: "SdS.Expertise",
};
preLocalize("proficiencyLevels");

/* -------------------------------------------- */

/**
 * The amount of cover provided by an object. In cases where multiple pieces
 * of cover are in play, we take the highest value.
 * @enum {string}
 */
SdS.cover = {
  0: "SdS.None",
  0.5: "SdS.CoverHalf",
  0.75: "SdS.CoverThreeQuarters",
  1: "SdS.CoverTotal",
};
preLocalize("cover");

/* -------------------------------------------- */

/**
 * A selection of actor attributes that can be tracked on token resource bars.
 * @type {string[]}
 */
SdS.trackableAttributes = [
  "attributes.ac.value",
  "attributes.init.bonus",
  "attributes.movement",
  "attributes.senses",
  "attributes.spelldc",
  "attributes.spellLevel",
  "details.cr",
  "details.spellLevel",
  "details.xp.value",
  "skills.*.passive",
  "abilities.*.value",
];

/* -------------------------------------------- */

/**
 * A selection of actor and item attributes that are valid targets for item resource consumption.
 * @type {string[]}
 */
SdS.consumableResources = [
  "item.quantity",
  "item.weight",
  "item.duration.value",
  "currency",
  "details.xp.value",
  "abilities.*.value",
  "attributes.senses",
  "attributes.movement",
  "attributes.ac.flat",
  "item.armor.value",
  "item.target",
  "item.range",
  "item.save.dc",
];

/* -------------------------------------------- */

/**
 * Conditions that can effect an actor.
 * @enum {string}
 */
SdS.conditionTypes = {
  blinded: "SdS.ConBlinded",
  charmed: "SdS.ConCharmed",
  deafened: "SdS.ConDeafened",
  diseased: "SdS.ConDiseased",
  exhaustion: "SdS.ConExhaustion",
  frightened: "SdS.ConFrightened",
  grappled: "SdS.ConGrappled",
  incapacitated: "SdS.ConIncapacitated",
  invisible: "SdS.ConInvisible",
  paralyzed: "SdS.ConParalyzed",
  petrified: "SdS.ConPetrified",
  poisoned: "SdS.ConPoisoned",
  prone: "SdS.ConProne",
  restrained: "SdS.ConRestrained",
  stunned: "SdS.ConStunned",
  unconscious: "SdS.ConUnconscious",
};
preLocalize("conditionTypes", { sort: true });

/**
 * Languages a character can learn.
 * @enum {string}
 */
SdS.languages = {
  common: "SdS.LanguagesCommon",
  aarakocra: "SdS.LanguagesAarakocra",
  abyssal: "SdS.LanguagesAbyssal",
  aquan: "SdS.LanguagesAquan",
  auran: "SdS.LanguagesAuran",
  celestial: "SdS.LanguagesCelestial",
  deep: "SdS.LanguagesDeepSpeech",
  draconic: "SdS.LanguagesDraconic",
  druidic: "SdS.LanguagesDruidic",
  dwarvish: "SdS.LanguagesDwarvish",
  elvish: "SdS.LanguagesElvish",
  giant: "SdS.LanguagesGiant",
  gith: "SdS.LanguagesGith",
  gnomish: "SdS.LanguagesGnomish",
  goblin: "SdS.LanguagesGoblin",
  gnoll: "SdS.LanguagesGnoll",
  halfling: "SdS.LanguagesHalfling",
  ignan: "SdS.LanguagesIgnan",
  infernal: "SdS.LanguagesInfernal",
  orc: "SdS.LanguagesOrc",
  primordial: "SdS.LanguagesPrimordial",
  sylvan: "SdS.LanguagesSylvan",
  terran: "SdS.LanguagesTerran",
  cant: "SdS.LanguagesThievesCant",
  undercommon: "SdS.LanguagesUndercommon",
};
preLocalize("languages", { sort: true });

/**
 * Maximum allowed character level.
 * @type {number}
 */
SdS.maxLevel = 20;

/**
 * XP required to achieve each character level.
 * @type {number[]}
 */
SdS.CHARACTER_EXP_LEVELS = [
  0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000,
  120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000,
];

/**
 * XP granted for each challenge rating.
 * @type {number[]}
 */
SdS.CR_EXP_LEVELS = [
  10, 200, 450, 700, 1100, 1800, 2300, 2900, 3900, 5000, 5900, 7200, 8400,
  10000, 11500, 13000, 15000, 18000, 20000, 22000, 25000, 33000, 41000, 50000,
  62000, 75000, 90000, 105000, 120000, 135000, 155000,
];

/**
 * @typedef {object} CharacterFlagConfig
 * @property {string} name
 * @property {string} hint
 * @property {string} section
 * @property {typeof boolean|string|number} type
 * @property {string} placeholder
 * @property {string[]} [abilities]
 * @property {Object<string, string>} [choices]
 * @property {string[]} [skills]
 */

/* -------------------------------------------- */

/**
 * Trait configuration information.
 *
 * @typedef {object} TraitConfiguration
 * @property {string} label               Localization key for the trait name.
 * @property {string} [actorKeyPath]      If the trait doesn't directly map to an entry as `traits.[key]`, where is
 *                                        this trait's data stored on the actor?
 * @property {string} [configKey]         If the list of trait options doesn't match the name of the trait, where can
 *                                        the options be found within `CONFIG.SdS`?
 * @property {string} [labelKey]          If config is an enum of objects, where can the label be found?
 * @property {object} [subtypes]          Configuration for traits that take some sort of base item.
 * @property {string} [subtypes.keyPath]  Path to subtype value on base items, should match a category key.
 * @property {string[]} [subtypes.ids]    Key for base item ID objects within `CONFIG.SdS`.
 * @property {object} [children]          Mapping of category key to an object defining its children.
 * @property {boolean} [sortCategories]   Whether top-level categories should be sorted.
 */

/**
 * Configurable traits on actors.
 * @enum {TraitConfiguration}
 */
SdS.traits = {
  saves: {
    label: "SdS.ClassSaves",
    configKey: "abilities",
  },
  skills: {
    label: "SdS.TraitSkillProf",
    labelKey: "label",
  },
  languages: {
    label: "SdS.Languages",
  },
  di: {
    label: "SdS.DamImm",
    configKey: "damageTypes",
  },
  dr: {
    label: "SdS.DamRes",
    configKey: "damageTypes",
  },
  dv: {
    label: "SdS.DamVuln",
    configKey: "damageTypes",
  },
  ci: {
    label: "SdS.ConImm",
    configKey: "conditionTypes",
  },
  weapon: {
    label: "SdS.TraitWeaponProf",
    actorKeyPath: "traits.weaponProf",
    configKey: "weaponProficiencies",
    subtypes: { keyPath: "weaponType", ids: ["weaponIds"] },
  },
  armor: {
    label: "SdS.TraitArmorProf",
    actorKeyPath: "traits.armorProf",
    configKey: "armorProficiencies",
    subtypes: { keyPath: "armor.type", ids: ["armorIds", "shieldIds"] },
  },
  tool: {
    label: "SdS.TraitToolProf",
    actorKeyPath: "traits.toolProf",
    configKey: "toolProficiencies",
    subtypes: { keyPath: "toolType", ids: ["toolIds"] },
    children: { vehicle: "vehicleTypes" },
    sortCategories: true,
  },
};
preLocalize("traits", { key: "label" });

/* -------------------------------------------- */

/**
 * Special character flags.
 * @enum {CharacterFlagConfig}
 */
SdS.characterFlags = {
  diamondSoul: {
    name: "SdS.FlagsDiamondSoul",
    hint: "SdS.FlagsDiamondSoulHint",
    section: "SdS.Feats",
    type: Boolean,
  },
  elvenAccuracy: {
    name: "SdS.FlagsElvenAccuracy",
    hint: "SdS.FlagsElvenAccuracyHint",
    section: "SdS.RacialTraits",
    abilities: ["dex", "int", "wis", "cha"],
    type: Boolean,
  },
  halflingLucky: {
    name: "SdS.FlagsHalflingLucky",
    hint: "SdS.FlagsHalflingLuckyHint",
    section: "SdS.RacialTraits",
    type: Boolean,
  },
  initiativeAdv: {
    name: "SdS.FlagsInitiativeAdv",
    hint: "SdS.FlagsInitiativeAdvHint",
    section: "SdS.Feats",
    type: Boolean,
  },
  initiativeAlert: {
    name: "SdS.FlagsAlert",
    hint: "SdS.FlagsAlertHint",
    section: "SdS.Feats",
    type: Boolean,
  },
  jackOfAllTrades: {
    name: "SdS.FlagsJOAT",
    hint: "SdS.FlagsJOATHint",
    section: "SdS.Feats",
    type: Boolean,
  },
  observantFeat: {
    name: "SdS.FlagsObservant",
    hint: "SdS.FlagsObservantHint",
    skills: ["prc", "inv"],
    section: "SdS.Feats",
    type: Boolean,
  },
  powerfulBuild: {
    name: "SdS.FlagsPowerfulBuild",
    hint: "SdS.FlagsPowerfulBuildHint",
    section: "SdS.RacialTraits",
    type: Boolean,
  },
  reliableTalent: {
    name: "SdS.FlagsReliableTalent",
    hint: "SdS.FlagsReliableTalentHint",
    section: "SdS.Feats",
    type: Boolean,
  },
  remarkableAthlete: {
    name: "SdS.FlagsRemarkableAthlete",
    hint: "SdS.FlagsRemarkableAthleteHint",
    abilities: ["str", "dex", "con"],
    section: "SdS.Feats",
    type: Boolean,
  },
  weaponCriticalThreshold: {
    name: "SdS.FlagsWeaponCritThreshold",
    hint: "SdS.FlagsWeaponCritThresholdHint",
    section: "SdS.Feats",
    type: Number,
    placeholder: 20,
  },
  spellCriticalThreshold: {
    name: "SdS.FlagsSpellCritThreshold",
    hint: "SdS.FlagsSpellCritThresholdHint",
    section: "SdS.Feats",
    type: Number,
    placeholder: 20,
  },
  meleeCriticalDamageDice: {
    name: "SdS.FlagsMeleeCriticalDice",
    hint: "SdS.FlagsMeleeCriticalDiceHint",
    section: "SdS.Feats",
    type: Number,
    placeholder: 0,
  },
};
preLocalize("characterFlags", { keys: ["name", "hint", "section"] });

/**
 * Flags allowed on actors. Any flags not in the list may be deleted during a migration.
 * @type {string[]}
 */
SdS.allowedActorFlags = ["isPolymorphed", "originalActor"].concat(
  Object.keys(SdS.characterFlags)
);

/* -------------------------------------------- */

/**
 * Advancement types that can be added to items.
 * @enum {*}
 */
SdS.advancementTypes = {
  HitPoints: HitPointsAdvancement,
  ManaPoints: ManaPointsAdvancement,
  ItemGrant: ItemGrantAdvancement,
  ScaleValue: ScaleValueAdvancement,
};

/* -------------------------------------------- */

/**
 * Patch an existing config enum to allow conversion from string values to object values without
 * breaking existing modules that are expecting strings.
 * @param {string} key          Key within SdS that has been replaced with an enum of objects.
 * @param {string} fallbackKey  Key within the new config object from which to get the fallback value.
 * @param {object} [options]    Additional options passed through to logCompatibilityWarning.
 */
function patchConfig(key, fallbackKey, options) {
  /** @override */
  function toString() {
    const message =
      `The value of CONFIG.SdS.${key} has been changed to an object.` +
      ` The former value can be acccessed from .${fallbackKey}.`;
    foundry.utils.logCompatibilityWarning(message, options);
    return this[fallbackKey];
  }

  Object.values(SdS[key]).forEach((o) => (o.toString = toString));
}

/**
 * @typedef {object} ModuleArtInfo
 * @property {string} actor         The path to the actor's portrait image.
 * @property {string|object} token  The path to the token image, or a richer object specifying additional token
 *                                  adjustments.
 */

/**
 * A class responsible for managing module-provided art in compendia.
 */
class ModuleArt {
  constructor() {
    /**
     * The stored map of actor UUIDs to their art information.
     * @type {Map<string, ModuleArtInfo>}
     */
    Object.defineProperty(this, "map", { value: new Map(), writable: false });
  }

  /* -------------------------------------------- */

  /**
   * Set to true to temporarily prevent actors from loading module art.
   * @type {boolean}
   */
  suppressArt = false;

  /* -------------------------------------------- */

  /**
   * Register any art mapping information included in active modules.
   * @returns {Promise<void>}
   */
  async registerModuleArt() {
    this.map.clear();
    for (const module of game.modules) {
      const flags = module.flags?.[module.id];
      const artPath = this.constructor.getModuleArtPath(module);
      if (!artPath) continue;
      try {
        const mapping = await foundry.utils.fetchJsonWithTimeout(artPath);
        await this.#parseArtMapping(
          module.id,
          mapping,
          flags["sds-art-credit"]
        );
      } catch (e) {
        console.error(e);
      }
    }

    // Load system mapping.
    try {
      const mapping = await foundry.utils.fetchJsonWithTimeout(
        "systems/sds/json/fa-token-mapping.json"
      );
      const credit = `
        <em>
          Token artwork by
          <a href="https://www.forgotten-adventures.net/" target="_blank" rel="noopener">Forgotten Adventures</a>.
        </em>
      `;
      await this.#parseArtMapping(game.system.id, mapping, credit);
    } catch (e) {
      console.error(e);
    }
  }

  /* -------------------------------------------- */

  /**
   * Parse a provided module art mapping and store it for reference later.
   * @param {string} moduleId  The module ID.
   * @param {object} mapping   A mapping containing pack names, a list of actor IDs, and paths to the art provided by
   *                           the module for them.
   * @param {string} [credit]  An optional credit line to attach to the Actor's biography.
   * @returns {Promise<void>}
   */
  async #parseArtMapping(moduleId, mapping, credit) {
    let settings = game.settings.get("sds", "moduleArtConfiguration")?.[
      moduleId
    ];
    settings ??= { portraits: true, tokens: true };
    for (const [packName, actors] of Object.entries(mapping)) {
      const pack = game.packs.get(packName);
      if (!pack) continue;
      for (let [actorId, info] of Object.entries(actors)) {
        const entry = pack.index.get(actorId);
        if (!entry || !(settings.portraits || settings.tokens)) continue;
        if (settings.portraits) entry.img = info.actor;
        else delete info.actor;
        if (!settings.tokens) delete info.token;
        if (credit) info.credit = credit;
        const uuid = `Compendium.${packName}.${actorId}`;
        info = foundry.utils.mergeObject(this.map.get(uuid) ?? {}, info, {
          inplace: false,
        });
        this.map.set(`Compendium.${packName}.${actorId}`, info);
      }
    }
  }

  /* -------------------------------------------- */

  /**
   * If a module provides art, return the path to is JSON mapping.
   * @param {Module} module  The module.
   * @returns {string|null}
   */
  static getModuleArtPath(module) {
    const flags = module.flags?.[module.id];
    const artPath = flags?.["sds-art"];
    if (!artPath || !module.active) return null;
    return artPath;
  }
}

/**
 * A class responsible for allowing GMs to configure art provided by installed modules.
 */
class ModuleArtConfig extends FormApplication {
  /** @inheritdoc */
  constructor(object = {}, options = {}) {
    object = foundry.utils.mergeObject(
      game.settings.get("sds", "moduleArtConfiguration"),
      object,
      { inplace: false }
    );
    super(object, options);
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      title: game.i18n.localize("SdS.ModuleArtConfigL"),
      id: "module-art-config",
      template: "systems/sds/templates/apps/module-art-config.html",
      popOut: true,
      width: 600,
      height: "auto",
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  getData(options = {}) {
    const context = super.getData(options);
    context.config = [];
    for (const module of game.modules) {
      if (!ModuleArt.getModuleArtPath(module)) continue;
      const settings = this.object[module.id] ?? {
        portraits: true,
        tokens: true,
      };
      context.config.push({ label: module.title, id: module.id, ...settings });
    }
    context.config.sort((a, b) =>
      a.label.localeCompare(b.label, game.i18n.lang)
    );
    context.config.unshift({
      label: game.system.title,
      id: game.system.id,
      ...this.object.sds,
    });
    return context;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async _updateObject(event, formData) {
    await game.settings.set(
      "sds",
      "moduleArtConfiguration",
      foundry.utils.expandObject(formData)
    );
    return SettingsConfig.reloadConfirm({ world: true });
  }
}

/**
 * Register all of the system's settings.
 */
function registerSystemSettings() {
  // Internal System Migration Version
  game.settings.register("sds", "systemMigrationVersion", {
    name: "System Migration Version",
    scope: "world",
    config: false,
    type: String,
    default: "",
  });

  // Rest Recovery Rules
  game.settings.register("sds", "restVariant", {
    name: "SETTINGS.5eRestN",
    hint: "SETTINGS.5eRestL",
    scope: "world",
    config: true,
    default: "normal",
    type: String,
    choices: {
      normal: "SETTINGS.5eRestPHB",
      gritty: "SETTINGS.5eRestGritty",
      epic: "SETTINGS.5eRestEpic",
    },
  });

  // Diagonal Movement Rule
  game.settings.register("sds", "diagonalMovement", {
    name: "SETTINGS.5eDiagN",
    hint: "SETTINGS.5eDiagL",
    scope: "world",
    config: true,
    default: "555",
    type: String,
    choices: {
      555: "SETTINGS.5eDiagPHB",
      5105: "SETTINGS.5eDiagDMG",
      EUCL: "SETTINGS.5eDiagEuclidean",
    },
    onChange: (rule) => (canvas.grid.diagonalRule = rule),
  });

  // Proficiency modifier type
  game.settings.register("sds", "proficiencyModifier", {
    name: "SETTINGS.5eProfN",
    hint: "SETTINGS.5eProfL",
    scope: "world",
    config: true,
    default: "bonus",
    type: String,
    choices: {
      bonus: "SETTINGS.5eProfBonus",
      dice: "SETTINGS.5eProfDice",
    },
  });

  // Use Honor ability score
  game.settings.register("sds", "honorScore", {
    name: "SETTINGS.5eHonorN",
    hint: "SETTINGS.5eHonorL",
    scope: "world",
    config: true,
    default: false,
    type: Boolean,
    requiresReload: true,
  });

  // Use Sanity ability score
  game.settings.register("sds", "sanityScore", {
    name: "SETTINGS.5eSanityN",
    hint: "SETTINGS.5eSanityL",
    scope: "world",
    config: true,
    default: false,
    type: Boolean,
    requiresReload: true,
  });

  // Apply Dexterity as Initiative Tiebreaker
  game.settings.register("sds", "initiativeDexTiebreaker", {
    name: "SETTINGS.5eInitTBN",
    hint: "SETTINGS.5eInitTBL",
    scope: "world",
    config: true,
    default: false,
    type: Boolean,
  });

  // Record Currency Weight
  game.settings.register("sds", "currencyWeight", {
    name: "SETTINGS.5eCurWtN",
    hint: "SETTINGS.5eCurWtL",
    scope: "world",
    config: true,
    default: true,
    type: Boolean,
  });

  // Disable Experience Tracking
  game.settings.register("sds", "disableExperienceTracking", {
    name: "SETTINGS.5eNoExpN",
    hint: "SETTINGS.5eNoExpL",
    scope: "world",
    config: true,
    default: false,
    type: Boolean,
  });

  // Disable Advancements
  game.settings.register("sds", "disableAdvancements", {
    name: "SETTINGS.5eNoAdvancementsN",
    hint: "SETTINGS.5eNoAdvancementsL",
    scope: "world",
    config: true,
    default: false,
    type: Boolean,
  });

  // Collapse Item Cards (by default)
  game.settings.register("sds", "autoCollapseItemCards", {
    name: "SETTINGS.5eAutoCollapseCardN",
    hint: "SETTINGS.5eAutoCollapseCardL",
    scope: "client",
    config: true,
    default: false,
    type: Boolean,
    onChange: (s) => {
      ui.chat.render();
    },
  });

  // Allow Polymorphing
  game.settings.register("sds", "allowPolymorphing", {
    name: "SETTINGS.5eAllowPolymorphingN",
    hint: "SETTINGS.5eAllowPolymorphingL",
    scope: "world",
    config: true,
    default: false,
    type: Boolean,
  });

  // Polymorph Settings
  game.settings.register("sds", "polymorphSettings", {
    scope: "client",
    default: {
      keepPhysical: false,
      keepMental: false,
      keepSaves: false,
      keepSkills: false,
      mergeSaves: false,
      mergeSkills: false,
      keepClass: false,
      keepFeats: false,
      keepSpells: false,
      keepItems: false,
      keepBio: false,
      keepVision: true,
      keepSelf: false,
      keepAE: false,
      keepOriginAE: true,
      keepOtherOriginAE: true,
      keepFeatAE: true,
      keepSpellAE: true,
      keepEquipmentAE: true,
      keepClassAE: true,
      keepBackgroundAE: true,
      transformTokens: true,
    },
  });

  // Metric Unit Weights
  game.settings.register("sds", "metricWeightUnits", {
    name: "SETTINGS.5eMetricN",
    hint: "SETTINGS.5eMetricL",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  // Critical Damage Modifiers
  game.settings.register("sds", "criticalDamageModifiers", {
    name: "SETTINGS.5eCriticalModifiersN",
    hint: "SETTINGS.5eCriticalModifiersL",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  // Critical Damage Maximize
  game.settings.register("sds", "criticalDamageMaxDice", {
    name: "SETTINGS.5eCriticalMaxDiceN",
    hint: "SETTINGS.5eCriticalMaxDiceL",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  // Strict validation
  game.settings.register("sds", "strictValidation", {
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  // Dynamic art.
  game.settings.registerMenu("sds", "moduleArtConfiguration", {
    name: "SdS.ModuleArtConfigN",
    label: "SdS.ModuleArtConfigL",
    hint: "SdS.ModuleArtConfigH",
    icon: "fa-solid fa-palette",
    type: ModuleArtConfig,
    restricted: true,
  });

  game.settings.register("sds", "moduleArtConfiguration", {
    name: "Module Art Configuration",
    scope: "world",
    config: false,
    type: Object,
    default: {
      sds: {
        portraits: true,
        tokens: true,
      },
    },
  });
}

/**
 * Extend the base ActiveEffect class to implement system-specific logic.
 */
class ActiveEffect5e extends ActiveEffect {
  /**
   * Is this active effect currently suppressed?
   * @type {boolean}
   */
  isSuppressed = false;

  /* --------------------------------------------- */

  /** @inheritdoc */
  apply(actor, change) {
    if (this.isSuppressed) return null;
    if (change.key.startsWith("flags.sds."))
      change = this._prepareFlagChange(actor, change);
    return super.apply(actor, change);
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _applyAdd(actor, change, current, delta, changes) {
    if (current instanceof Set) {
      if (Array.isArray(delta)) delta.forEach((item) => current.add(item));
      else current.add(delta);
      return;
    }
    super._applyAdd(actor, change, current, delta, changes);
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _applyOverride(actor, change, current, delta, changes) {
    if (current instanceof Set) {
      current.clear();
      if (Array.isArray(delta)) delta.forEach((item) => current.add(item));
      else current.add(delta);
      return;
    }
    return super._applyOverride(actor, change, current, delta, changes);
  }

  /* --------------------------------------------- */

  /**
   * Transform the data type of the change to match the type expected for flags.
   * @param {Actor5e} actor            The Actor to whom this effect should be applied.
   * @param {EffectChangeData} change  The change being applied.
   * @returns {EffectChangeData}       The change with altered types if necessary.
   */
  _prepareFlagChange(actor, change) {
    const { key, value } = change;
    const data = CONFIG.SdS.characterFlags[key.replace("flags.sds.", "")];
    if (!data) return change;

    // Set flag to initial value if it isn't present
    const current = foundry.utils.getProperty(actor, key) ?? null;
    if (current === null) {
      let initialValue = null;
      if (data.placeholder) initialValue = data.placeholder;
      else if (data.type === Boolean) initialValue = false;
      else if (data.type === Number) initialValue = 0;
      foundry.utils.setProperty(actor, key, initialValue);
    }

    // Coerce change data into the correct type
    if (data.type === Boolean) {
      if (value === "false") change.value = false;
      else change.value = Boolean(value);
    }
    return change;
  }

  /* --------------------------------------------- */

  /**
   * Determine whether this Active Effect is suppressed or not.
   */
  determineSuppression() {
    this.isSuppressed = false;
    if (this.disabled || this.parent.documentName !== "Actor") return;
    const parts = this.origin?.split(".") ?? [];
    const [
      parentType,
      parentId,
      documentType,
      documentId,
      syntheticItem,
      syntheticItemId,
    ] = parts;
    let item;
    // Case 1: This is a linked or sidebar actor
    if (parentType === "Actor") {
      if (parentId !== this.parent.id || documentType !== "Item") return;
      item = this.parent.items.get(documentId);
    }
    // Case 2: This is a synthetic actor on the scene
    else if (parentType === "Scene") {
      if (documentId !== this.parent.token?.id || syntheticItem !== "Item")
        return;
      item = this.parent.items.get(syntheticItemId);
    }
    if (!item) return;
    this.isSuppressed = item.areEffectsSuppressed;
  }

  /* --------------------------------------------- */

  /**
   * Manage Active Effect instances through the Actor Sheet via effect control buttons.
   * @param {MouseEvent} event      The left-click event on the effect control
   * @param {Actor5e|Item5e} owner  The owning document which manages this effect
   * @returns {Promise|null}        Promise that resolves when the changes are complete.
   */
  static onManageActiveEffect(event, owner) {
    event.preventDefault();
    const a = event.currentTarget;
    const li = a.closest("li");
    const effect = li.dataset.effectId
      ? owner.effects.get(li.dataset.effectId)
      : null;
    switch (a.dataset.action) {
      case "create":
        return owner.createEmbeddedDocuments("ActiveEffect", [
          {
            label: game.i18n.localize("SdS.EffectNew"),
            icon: "icons/svg/aura.svg",
            origin: owner.uuid,
            "duration.rounds":
              li.dataset.effectType === "temporary" ? 1 : undefined,
            disabled: li.dataset.effectType === "inactive",
          },
        ]);
      case "edit":
        return effect.sheet.render(true);
      case "delete":
        return effect.delete();
      case "toggle":
        return effect.update({ disabled: !effect.disabled });
    }
  }

  /* --------------------------------------------- */

  /**
   * Prepare the data structure for Active Effects which are currently applied to an Actor or Item.
   * @param {ActiveEffect5e[]} effects  The array of Active Effect instances to prepare sheet data for
   * @returns {object}                  Data for rendering
   */
  static prepareActiveEffectCategories(effects) {
    // Define effect header categories
    const categories = {
      temporary: {
        type: "temporary",
        label: game.i18n.localize("SdS.EffectTemporary"),
        effects: [],
      },
      passive: {
        type: "passive",
        label: game.i18n.localize("SdS.EffectPassive"),
        effects: [],
      },
      inactive: {
        type: "inactive",
        label: game.i18n.localize("SdS.EffectInactive"),
        effects: [],
      },
      suppressed: {
        type: "suppressed",
        label: game.i18n.localize("SdS.EffectUnavailable"),
        effects: [],
        info: [game.i18n.localize("SdS.EffectUnavailableInfo")],
      },
    };

    // Iterate over active effects, classifying them into categories
    for (let e of effects) {
      e._getSourceName(); // Trigger a lookup for the source name
      if (e.isSuppressed) categories.suppressed.effects.push(e);
      else if (e.disabled) categories.inactive.effects.push(e);
      else if (e.isTemporary) categories.temporary.effects.push(e);
      else categories.passive.effects.push(e);
    }
    categories.suppressed.hidden = !categories.suppressed.effects.length;
    return categories;
  }
}

/**
 * Cached version of the base items compendia indices with the needed subtype fields.
 * @type {object}
 * @private
 */
const _cachedIndices = {};

/* -------------------------------------------- */
/*  Trait Lists                                 */
/* -------------------------------------------- */

/**
 * Get the key path to the specified trait on an actor.
 * @param {string} trait  Trait as defined in `CONFIG.SdS.traits`.
 * @returns {string}      Key path to this trait's object within an actor's system data.
 */
function actorKeyPath(trait) {
  const traitConfig = CONFIG.SdS.traits[trait];
  if (traitConfig.actorKeyPath) return traitConfig.actorKeyPath;
  return `traits.${trait}`;
}

/* -------------------------------------------- */

/**
 * Fetch the categories object for the specified trait.
 * @param {string} trait  Trait as defined in `CONFIG.SdS.traits`.
 * @returns {object}      Trait categories defined within `CONFIG.SdS`.
 */
function categories(trait) {
  const traitConfig = CONFIG.SdS.traits[trait];
  return CONFIG.SdS[traitConfig.configKey ?? trait];
}

/* -------------------------------------------- */

/**
 * Get a list of choices for a specific trait.
 * @param {string} trait             Trait as defined in `CONFIG.SdS.traits`.
 * @param {Set<string>} [chosen=[]]  Optional list of keys to be marked as chosen.
 * @returns {object}                 Object mapping proficiency ids to choice objects.
 */
async function choices(trait, chosen = new Set()) {
  const traitConfig = CONFIG.SdS.traits[trait];
  if (foundry.utils.getType(chosen) === "Array") chosen = new Set(chosen);

  let data = Object.entries(categories(trait)).reduce((obj, [key, label]) => {
    obj[key] = { label, chosen: chosen.has(key) };
    return obj;
  }, {});

  if (traitConfig.children) {
    for (const [categoryKey, childrenKey] of Object.entries(
      traitConfig.children
    )) {
      const children = CONFIG.SdS[childrenKey];
      if (!children || !data[categoryKey]) continue;
      data[categoryKey].children = Object.entries(children).reduce(
        (obj, [key, label]) => {
          obj[key] = { label, chosen: chosen.has(key) };
          return obj;
        },
        {}
      );
    }
  }

  if (traitConfig.subtypes) {
    const keyPath = `system.${traitConfig.subtypes.keyPath}`;
    const map = CONFIG.SdS[`${trait}ProficienciesMap`];

    // Merge all IDs lists together
    const ids = traitConfig.subtypes.ids.reduce((obj, key) => {
      if (CONFIG.SdS[key]) Object.assign(obj, CONFIG.SdS[key]);
      return obj;
    }, {});

    // Fetch base items for all IDs
    const baseItems = await Promise.all(
      Object.entries(ids).map(async ([key, id]) => {
        const index = await getBaseItem(id);
        return [key, index];
      })
    );

    // Sort base items as children of categories based on subtypes
    for (const [key, index] of baseItems) {
      if (!index) continue;

      // Get the proper subtype, using proficiency map if needed
      let type = foundry.utils.getProperty(index, keyPath);
      if (map?.[type]) type = map[type];

      const entry = { label: index.name, chosen: chosen.has(key) };

      // No category for this type, add at top level
      if (!data[type]) data[key] = entry;
      // Add as child to appropriate category
      else {
        data[type].children ??= {};
        data[type].children[key] = entry;
      }
    }
  }

  // Sort Categories
  if (traitConfig.sortCategories)
    data = sds.utils.sortObjectEntries(data, "label");

  // Sort Children
  for (const category of Object.values(data)) {
    if (!category.children) continue;
    category.children = sds.utils.sortObjectEntries(category.children, "label");
  }

  return data;
}

/* -------------------------------------------- */

/**
 * Fetch an item for the provided ID. If the provided ID contains a compendium pack name
 * it will be fetched from that pack, otherwise it will be fetched from the compendium defined
 * in `SdS.sourcePacks.ITEMS`.
 * @param {string} identifier            Simple ID or compendium name and ID separated by a dot.
 * @param {object} [options]
 * @param {boolean} [options.indexOnly]  If set to true, only the index data will be fetched (will never return
 *                                       Promise).
 * @param {boolean} [options.fullItem]   If set to true, the full item will be returned as long as `indexOnly` is
 *                                       false.
 * @returns {Promise<Item5e>|object}     Promise for a `Document` if `indexOnly` is false & `fullItem` is true,
 *                                       otherwise else a simple object containing the minimal index data.
 */
function getBaseItem(identifier, { indexOnly = false, fullItem = false } = {}) {
  let pack = CONFIG.SdS.sourcePacks.ITEMS;
  let [scope, collection, id] = identifier.split(".");
  if (scope && collection) pack = `${scope}.${collection}`;
  if (!id) id = identifier;

  const packObject = game.packs.get(pack);

  // Full Item5e document required, always async.
  if (fullItem && !indexOnly) return packObject?.getDocument(id);

  const cache = _cachedIndices[pack];
  const loading = cache instanceof Promise;

  // Return extended index if cached, otherwise normal index, guaranteed to never be async.
  if (indexOnly) {
    const index = packObject?.index.get(id);
    return loading ? index : cache?.[id] ?? index;
  }

  // Returned cached version of extended index if available.
  if (loading) return cache.then(() => _cachedIndices[pack][id]);
  else if (cache) return cache[id];
  if (!packObject) return;

  // Build the extended index and return a promise for the data
  const promise = packObject
    .getIndex({ fields: traitIndexFields() })
    .then((index) => {
      const store = index.reduce((obj, entry) => {
        obj[entry._id] = entry;
        return obj;
      }, {});
      _cachedIndices[pack] = store;
      return store[id];
    });
  _cachedIndices[pack] = promise;
  return promise;
}

/* -------------------------------------------- */

/**
 * List of fields on items that should be indexed for retrieving subtypes.
 * @returns {string[]}  Index list to pass to `Compendium#getIndex`.
 * @protected
 */
function traitIndexFields() {
  const fields = [];
  for (const traitConfig of Object.values(CONFIG.SdS.traits)) {
    if (!traitConfig.subtypes) continue;
    fields.push(`system.${traitConfig.subtypes.keyPath}`);
  }
  return fields;
}

/* -------------------------------------------- */
/*  Localized Formatting Methods                */
/* -------------------------------------------- */

/**
 * Get the localized label for a specific trait type.
 * @param {string} trait    Trait as defined in `CONFIG.SdS.traits`.
 * @param {number} [count]  Count used to determine pluralization. If no count is provided, will default to
 *                          the 'other' pluralization.
 * @returns {string}        Localized label.
 */
function traitLabel(trait, count) {
  let typeCap;
  if (trait.length === 2) typeCap = trait.toUpperCase();
  else typeCap = trait.capitalize();

  const pluralRule =
    count !== undefined
      ? new Intl.PluralRules(game.i18n.lang).select(count)
      : "other";
  return game.i18n.localize(`SdS.Trait${typeCap}Plural.${pluralRule}`);
}

/* -------------------------------------------- */

/**
 * Retrieve the proper display label for the provided key.
 * @param {string} trait  Trait as defined in `CONFIG.SdS.traits`.
 * @param {string} key    Key for which to generate the label.
 * @returns {string}      Retrieved label.
 */
function keyLabel(trait, key) {
  const traitConfig = CONFIG.SdS.traits[trait];
  if (categories(trait)[key]) {
    const category = categories(trait)[key];
    if (!traitConfig.labelKey) return category;
    return foundry.utils.getProperty(category, traitConfig.labelKey);
  }

  for (const childrenKey of Object.values(traitConfig.children ?? {})) {
    if (CONFIG.SdS[childrenKey]?.[key]) return CONFIG.SdS[childrenKey]?.[key];
  }

  for (const idsKey of traitConfig.subtypes?.ids ?? []) {
    if (!CONFIG.SdS[idsKey]?.[key]) continue;
    const index = getBaseItem(CONFIG.SdS[idsKey][key], { indexOnly: true });
    if (index) return index.name;
    else break;
  }

  return key;
}

/* -------------------------------------------- */

/**
 * Create a human readable description of the provided choice.
 * @param {string} trait        Trait as defined in `CONFIG.SdS.traits`.
 * @param {TraitChoice} choice  Data for a specific choice.
 * @returns {string}
 */
function choiceLabel(trait, choice) {
  // Select from any trait values
  if (!choice.pool) {
    return game.i18n.format("SdS.TraitConfigChooseAny", {
      count: choice.count,
      type: traitLabel(trait, choice.count).toLowerCase(),
    });
  }

  // Select from a list of options
  const choices = choice.pool.map((key) => keyLabel(trait, key));
  const listFormatter = new Intl.ListFormat(game.i18n.lang, {
    type: "disjunction",
  });
  return game.i18n.format("SdS.TraitConfigChooseList", {
    count: choice.count,
    list: listFormatter.format(choices),
  });
}

var trait = /*#__PURE__*/ Object.freeze({
  __proto__: null,
  actorKeyPath: actorKeyPath,
  categories: categories,
  choiceLabel: choiceLabel,
  choices: choices,
  getBaseItem: getBaseItem,
  keyLabel: keyLabel,
  traitIndexFields: traitIndexFields,
  traitLabel: traitLabel,
});

/* -------------------------------------------- */
/* D20 Roll                                     */
/* -------------------------------------------- */

/**
 * Configuration data for a D20 roll.
 *
 * @typedef {object} D20RollConfiguration
 *
 * @property {string[]} [parts=[]]  The dice roll component parts, excluding the initial d20.
 * @property {object} [data={}]     Data that will be used when parsing this roll.
 * @property {Event} [event]        The triggering event for this roll.
 *
 * ## D20 Properties
 * @property {boolean} [advantage]     Apply advantage to this roll (unless overridden by modifier keys or dialog)?
 * @property {boolean} [disadvantage]  Apply disadvantage to this roll (unless overridden by modifier keys or dialog)?
 * @property {number|null} [critical=20]  The value of the d20 result which represents a critical success,
 *                                     `null` will prevent critical successes.
 * @property {number|null} [fumble=1]  The value of the d20 result which represents a critical failure,
 *                                     `null` will prevent critical failures.
 * @property {number} [targetValue]    The value of the d20 result which should represent a successful roll.
 *
 * ## Flags
 * @property {boolean} [elvenAccuracy]   Allow Elven Accuracy to modify this roll?
 * @property {boolean} [halflingLucky]   Allow Halfling Luck to modify this roll?
 * @property {boolean} [reliableTalent]  Allow Reliable Talent to modify this roll?
 *
 * ## Roll Configuration Dialog
 * @property {boolean} [fastForward]           Should the roll configuration dialog be skipped?
 * @property {boolean} [chooseModifier=false]  If the configuration dialog is shown, should the ability modifier be
 *                                             configurable within that interface?
 * @property {string} [template]               The HTML template used to display the roll configuration dialog.
 * @property {string} [title]                  Title of the roll configuration dialog.
 * @property {object} [dialogOptions]          Additional options passed to the roll configuration dialog.
 *
 * ## Chat Message
 * @property {boolean} [chatMessage=true]  Should a chat message be created for this roll?
 * @property {object} [messageData={}]     Additional data which is applied to the created chat message.
 * @property {string} [rollMode]           Value of `CONST.DICE_ROLL_MODES` to apply as default for the chat message.
 * @property {object} [flavor]             Flavor text to use in the created chat message.
 */

/**
 * A standardized helper function for managing core 5e d20 rolls.
 * Holding SHIFT, ALT, or CTRL when the attack is rolled will "fast-forward".
 * This chooses the default options of a normal attack with no bonus, Advantage, or Disadvantage respectively
 *
 * @param {D20RollConfiguration} configuration  Configuration data for the D20 roll.
 * @returns {Promise<D20Roll|null>}             The evaluated D20Roll, or null if the workflow was cancelled.
 */
async function d20Roll({
  parts = [],
  data = {},
  event,
  advantage,
  disadvantage,
  critical = 20,
  fumble = 1,
  targetValue,
  elvenAccuracy,
  halflingLucky,
  reliableTalent,
  fastForward,
  chooseModifier = false,
  template,
  title,
  dialogOptions,
  chatMessage = true,
  messageData = {},
  rollMode,
  flavor,
} = {}) {
  // Handle input arguments
  const formula = ["1d20"].concat(parts).join(" + ");
  const { advantageMode, isFF } = CONFIG.Dice.D20Roll.determineAdvantageMode({
    advantage,
    disadvantage,
    fastForward,
    event,
  });
  const defaultRollMode = rollMode || game.settings.get("core", "rollMode");
  if (chooseModifier && !isFF) {
    data.mod = "@mod";
    if ("abilityCheckBonus" in data)
      data.abilityCheckBonus = "@abilityCheckBonus";
  }

  // Construct the D20Roll instance
  const roll = new CONFIG.Dice.D20Roll(formula, data, {
    flavor: flavor || title,
    advantageMode,
    defaultRollMode,
    rollMode,
    critical,
    fumble,
    targetValue,
    elvenAccuracy,
    halflingLucky,
    reliableTalent,
  });

  // Prompt a Dialog to further configure the D20Roll
  if (!isFF) {
    const configured = await roll.configureDialog(
      {
        title,
        chooseModifier,
        defaultRollMode,
        defaultAction: advantageMode,
        defaultAbility: data?.item?.ability || data?.defaultAbility,
        template,
      },
      dialogOptions
    );
    if (configured === null) return null;
  } else roll.options.rollMode ??= defaultRollMode;

  // Evaluate the configured roll
  await roll.evaluate({ async: true });

  // Create a Chat Message
  if (roll && chatMessage) await roll.toMessage(messageData);
  return roll;
}

/* -------------------------------------------- */
/* Damage Roll                                  */
/* -------------------------------------------- */

/**
 * Configuration data for a damage roll.
 *
 * @typedef {object} DamageRollConfiguration
 *
 * @property {string[]} [parts=[]]  The dice roll component parts.
 * @property {object} [data={}]     Data that will be used when parsing this roll.
 * @property {Event} [event]        The triggering event for this roll.
 *
 * ## Critical Handling
 * @property {boolean} [allowCritical=true]  Is this damage roll allowed to be rolled as critical?
 * @property {boolean} [critical]            Apply critical to this roll (unless overridden by modifier key or dialog)?
 * @property {number} [criticalBonusDice]    A number of bonus damage dice that are added for critical hits.
 * @property {number} [criticalMultiplier]   Multiplier to use when calculating critical damage.
 * @property {boolean} [multiplyNumeric]     Should numeric terms be multiplied when this roll criticals?
 * @property {boolean} [powerfulCritical]    Should the critical dice be maximized rather than rolled?
 * @property {string} [criticalBonusDamage]  An extra damage term that is applied only on a critical hit.
 *
 * ## Roll Configuration Dialog
 * @property {boolean} [fastForward]        Should the roll configuration dialog be skipped?
 * @property {string} [template]            The HTML template used to render the roll configuration dialog.
 * @property {string} [title]               Title of the roll configuration dialog.
 * @property {object} [dialogOptions]       Additional options passed to the roll configuration dialog.
 *
 * ## Chat Message
 * @property {boolean} [chatMessage=true]  Should a chat message be created for this roll?
 * @property {object} [messageData={}]     Additional data which is applied to the created chat message.
 * @property {string} [rollMode]           Value of `CONST.DICE_ROLL_MODES` to apply as default for the chat message.
 * @property {string} [flavor]             Flavor text to use in the created chat message.
 */

/**
 * A standardized helper function for managing core 5e damage rolls.
 * Holding SHIFT, ALT, or CTRL when the attack is rolled will "fast-forward".
 * This chooses the default options of a normal attack with no bonus, Critical, or no bonus respectively
 *
 * @param {DamageRollConfiguration} configuration  Configuration data for the Damage roll.
 * @returns {Promise<DamageRoll|null>}             The evaluated DamageRoll, or null if the workflow was canceled.
 */
async function damageRoll({
  parts = [],
  data = {},
  event,
  allowCritical = true,
  critical,
  criticalBonusDice,
  criticalMultiplier,
  multiplyNumeric,
  powerfulCritical,
  criticalBonusDamage,
  fastForward,
  template,
  title,
  dialogOptions,
  chatMessage = true,
  messageData = {},
  rollMode,
  flavor,
} = {}) {
  // Handle input arguments
  const defaultRollMode = rollMode || game.settings.get("core", "rollMode");

  // Construct the DamageRoll instance
  const formula = parts.join(" + ");
  const { isCritical, isFF } = _determineCriticalMode({
    critical,
    fastForward,
    event,
  });
  const roll = new CONFIG.Dice.DamageRoll(formula, data, {
    flavor: flavor || title,
    rollMode,
    critical: isFF ? isCritical : false,
    criticalBonusDice,
    criticalMultiplier,
    criticalBonusDamage,
    multiplyNumeric:
      multiplyNumeric ?? game.settings.get("sds", "criticalDamageModifiers"),
    powerfulCritical:
      powerfulCritical ?? game.settings.get("sds", "criticalDamageMaxDice"),
  });

  // Prompt a Dialog to further configure the DamageRoll
  if (!isFF) {
    const configured = await roll.configureDialog(
      {
        title,
        defaultRollMode: defaultRollMode,
        defaultCritical: isCritical,
        template,
        allowCritical,
      },
      dialogOptions
    );
    if (configured === null) return null;
  }

  // Evaluate the configured roll
  await roll.evaluate({ async: true });

  // Create a Chat Message
  if (roll && chatMessage) await roll.toMessage(messageData);
  return roll;
}

/* -------------------------------------------- */

/**
 * Determines whether this d20 roll should be fast-forwarded, and whether advantage or disadvantage should be applied
 * @param {object} [config]
 * @param {Event} [config.event]          Event that triggered the roll.
 * @param {boolean} [config.critical]     Is this roll treated as a critical by default?
 * @param {boolean} [config.fastForward]  Should the roll dialog be skipped?
 * @returns {{isFF: boolean, isCritical: boolean}}  Whether the roll is fast-forward, and whether it is a critical hit
 */
function _determineCriticalMode({ event, critical = false, fastForward } = {}) {
  const isFF =
    fastForward ??
    (event &&
      (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey));
  if (event?.altKey) critical = true;
  return { isFF: !!isFF, isCritical: critical };
}

/**
 * A standardized helper function for simplifying the constant parts of a multipart roll formula.
 *
 * @param {string} formula                          The original roll formula.
 * @param {object} [options]                        Formatting options.
 * @param {boolean} [options.preserveFlavor=false]  Preserve flavor text in the simplified formula.
 *
 * @returns {string}  The resulting simplified formula.
 */
function simplifyRollFormula(formula, { preserveFlavor = false } = {}) {
  // Create a new roll and verify that the formula is valid before attempting simplification.
  let roll;
  try {
    roll = new Roll(formula);
  } catch (err) {
    console.warn(`Unable to simplify formula '${formula}': ${err}`);
  }
  Roll.validate(roll.formula);

  // Optionally strip flavor annotations.
  if (!preserveFlavor)
    roll.terms = Roll.parse(roll.formula.replace(RollTerm.FLAVOR_REGEXP, ""));

  // Perform arithmetic simplification on the existing roll terms.
  roll.terms = _simplifyOperatorTerms(roll.terms);

  // If the formula contains multiplication or division we cannot easily simplify
  if (/[*/]/.test(roll.formula)) {
    if (
      roll.isDeterministic &&
      !/d\(/.test(roll.formula) &&
      (!/\[/.test(roll.formula) || !preserveFlavor)
    ) {
      return Roll.safeEval(roll.formula).toString();
    } else return roll.constructor.getFormula(roll.terms);
  }

  // Flatten the roll formula and eliminate string terms.
  roll.terms = _expandParentheticalTerms(roll.terms);
  roll.terms = Roll.simplifyTerms(roll.terms);

  // Group terms by type and perform simplifications on various types of roll term.
  let { poolTerms, diceTerms, mathTerms, numericTerms } = _groupTermsByType(
    roll.terms
  );
  numericTerms = _simplifyNumericTerms(numericTerms ?? []);
  diceTerms = _simplifyDiceTerms(diceTerms ?? []);

  // Recombine the terms into a single term array and remove an initial + operator if present.
  const simplifiedTerms = [diceTerms, poolTerms, mathTerms, numericTerms]
    .flat()
    .filter(Boolean);
  if (simplifiedTerms[0]?.operator === "+") simplifiedTerms.shift();
  return roll.constructor.getFormula(simplifiedTerms);
}

/* -------------------------------------------- */

/**
 * A helper function to perform arithmetic simplification and remove redundant operator terms.
 * @param {RollTerm[]} terms  An array of roll terms.
 * @returns {RollTerm[]}      A new array of roll terms with redundant operators removed.
 */
function _simplifyOperatorTerms(terms) {
  return terms.reduce((acc, term) => {
    const prior = acc[acc.length - 1];
    const ops = new Set([prior?.operator, term.operator]);

    // If one of the terms is not an operator, add the current term as is.
    if (ops.has(undefined)) acc.push(term);
    // Replace consecutive "+ -" operators with a "-" operator.
    else if (ops.has("+") && ops.has("-"))
      acc.splice(-1, 1, new OperatorTerm({ operator: "-" }));
    // Replace double "-" operators with a "+" operator.
    else if (ops.has("-") && ops.size === 1)
      acc.splice(-1, 1, new OperatorTerm({ operator: "+" }));
    // Don't include "+" operators that directly follow "+", "*", or "/". Otherwise, add the term as is.
    else if (!ops.has("+")) acc.push(term);

    return acc;
  }, []);
}

/* -------------------------------------------- */

/**
 * A helper function for combining unannotated numeric terms in an array into a single numeric term.
 * @param {object[]} terms  An array of roll terms.
 * @returns {object[]}      A new array of terms with unannotated numeric terms combined into one.
 */
function _simplifyNumericTerms(terms) {
  const simplified = [];
  const { annotated, unannotated } = _separateAnnotatedTerms(terms);

  // Combine the unannotated numerical bonuses into a single new NumericTerm.
  if (unannotated.length) {
    const staticBonus = Roll.safeEval(Roll.getFormula(unannotated));
    if (staticBonus === 0) return [...annotated];

    // If the staticBonus is greater than 0, add a "+" operator so the formula remains valid.
    if (staticBonus > 0) simplified.push(new OperatorTerm({ operator: "+" }));
    simplified.push(new NumericTerm({ number: staticBonus }));
  }
  return [...simplified, ...annotated];
}

/* -------------------------------------------- */

/**
 * A helper function to group dice of the same size and sign into single dice terms.
 * @param {object[]} terms  An array of DiceTerms and associated OperatorTerms.
 * @returns {object[]}      A new array of simplified dice terms.
 */
function _simplifyDiceTerms(terms) {
  const { annotated, unannotated } = _separateAnnotatedTerms(terms);

  // Split the unannotated terms into different die sizes and signs
  const diceQuantities = unannotated.reduce((obj, curr, i) => {
    if (curr instanceof OperatorTerm) return obj;
    const key = `${unannotated[i - 1].operator}${curr.faces}`;
    obj[key] = (obj[key] ?? 0) + curr.number;
    return obj;
  }, {});

  // Add new die and operator terms to simplified for each die size and sign
  const simplified = Object.entries(diceQuantities).flatMap(([key, number]) => [
    new OperatorTerm({ operator: key.charAt(0) }),
    new Die({ number, faces: parseInt(key.slice(1)) }),
  ]);
  return [...simplified, ...annotated];
}

/* -------------------------------------------- */

/**
 * A helper function to extract the contents of parenthetical terms into their own terms.
 * @param {object[]} terms  An array of roll terms.
 * @returns {object[]}      A new array of terms with no parenthetical terms.
 */
function _expandParentheticalTerms(terms) {
  terms = terms.reduce((acc, term) => {
    if (term instanceof ParentheticalTerm) {
      if (term.isDeterministic)
        term = new NumericTerm({ number: Roll.safeEval(term.term) });
      else {
        const subterms = new Roll(term.term).terms;
        term = _expandParentheticalTerms(subterms);
      }
    }
    acc.push(term);
    return acc;
  }, []);
  return _simplifyOperatorTerms(terms.flat());
}

/* -------------------------------------------- */

/**
 * A helper function to group terms into PoolTerms, DiceTerms, MathTerms, and NumericTerms.
 * MathTerms are included as NumericTerms if they are deterministic.
 * @param {RollTerm[]} terms  An array of roll terms.
 * @returns {object}          An object mapping term types to arrays containing roll terms of that type.
 */
function _groupTermsByType(terms) {
  // Add an initial operator so that terms can be rearranged arbitrarily.
  if (!(terms[0] instanceof OperatorTerm))
    terms.unshift(new OperatorTerm({ operator: "+" }));

  return terms.reduce((obj, term, i) => {
    let type;
    if (term instanceof DiceTerm) type = DiceTerm;
    else if (term instanceof MathTerm && term.isDeterministic)
      type = NumericTerm;
    else type = term.constructor;
    const key = `${type.name.charAt(0).toLowerCase()}${type.name.substring(
      1
    )}s`;

    // Push the term and the preceding OperatorTerm.
    (obj[key] = obj[key] ?? []).push(terms[i - 1], term);
    return obj;
  }, {});
}

/* -------------------------------------------- */

/**
 * A helper function to separate annotated terms from unannotated terms.
 * @param {object[]} terms     An array of DiceTerms and associated OperatorTerms.
 * @returns {Array | Array[]}  A pair of term arrays, one containing annotated terms.
 */
function _separateAnnotatedTerms(terms) {
  return terms.reduce(
    (obj, curr, i) => {
      if (curr instanceof OperatorTerm) return obj;
      obj[curr.flavor ? "annotated" : "unannotated"].push(terms[i - 1], curr);
      return obj;
    },
    { annotated: [], unannotated: [] }
  );
}

/**
 * A specialized Dialog subclass for ability usage.
 *
 * @param {Item5e} item             Item that is being used.
 * @param {object} [dialogData={}]  An object of dialog data which configures how the modal window is rendered.
 * @param {object} [options={}]     Dialog rendering options.
 */
class AbilityUseDialog extends Dialog {
  constructor(item, dialogData = {}, options = {}) {
    super(dialogData, options);
    this.options.classes = ["sds", "dialog"];

    /**
     * Store a reference to the Item document being used
     * @type {Item5e}
     */
    this.item = item;
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /**
   * A constructor function which displays the Spell Cast Dialog app for a given Actor and Item.
   * Returns a Promise which resolves to the dialog FormData once the workflow has been completed.
   * @param {Item5e} item  Item being used.
   * @returns {Promise}    Promise that is resolved when the use dialog is acted upon.
   */
  static async create(item) {
    if (!item.isOwned)
      throw new Error(
        "You cannot display an ability usage dialog for an unowned item"
      );

    // Prepare data
    const uses = item.system.uses ?? {};
    const resource = item.system.consume ?? {};
    const quantity = item.system.quantity ?? 0;
    const recharge = item.system.recharge ?? {};
    const recharges = !!recharge.value;
    const sufficientUses = (quantity > 0 && !uses.value) || uses.value > 0;

    // Prepare dialog form data
    const data = {
      item: item,
      title: game.i18n.format("SdS.AbilityUseHint", {
        type: game.i18n.localize(`ITEM.Type${item.type.capitalize()}`),
        name: item.name,
      }),
      note: this._getAbilityUseNote(item, uses, recharge),
      consumeSpellSlot: false,
      consumeSpellMana: false,
      consumeRecharge: recharges,
      consumeResource:
        resource.target && (!item.hasAttack || resource.type !== "ammo"),
      consumeUses: uses.per && uses.max > 0,
      canUse: recharges ? recharge.charged : sufficientUses,
      createTemplate: game.user.can("TEMPLATE_CREATE") && item.hasAreaTarget,
      errors: [],
    };
    if (item.type === "spell")
      this._getSpellData(item.actor.system, item.system, data);

    // Render the ability usage template
    const html = await renderTemplate(
      "systems/sds/templates/apps/ability-use.hbs",
      data
    );

    // Create the Dialog and return data as a Promise
    const icon = data.isSpell ? "fa-magic" : "fa-fist-raised";
    const label = game.i18n.localize(
      `SdS.AbilityUse${data.isSpell ? "Cast" : "Use"}`
    );
    return new Promise((resolve) => {
      const dlg = new this(item, {
        title: `${item.name}: ${game.i18n.localize("SdS.AbilityUseConfig")}`,
        content: html,
        buttons: {
          use: {
            icon: `<i class="fas ${icon}"></i>`,
            label: label,
            callback: (html) => {
              const fd = new FormDataExtended(html[0].querySelector("form"));
              resolve(fd.object);
            },
          },
        },
        default: "use",
        close: () => resolve(null),
      });
      dlg.render(true);
    });
  }

  /* -------------------------------------------- */
  /*  Helpers                                     */
  /* -------------------------------------------- */

  /**
   * Get dialog data related to limited spell slots.
   * @param {object} actorData  System data from the actor using the spell.
   * @param {object} itemData   System data from the spell being used.
   * @param {object} data       Data for the dialog being presented.
   * @returns {object}          Modified dialog data.
   * @private
   */
  static _getSpellData(actorData, itemData, data) {
    // Determine whether the spell may be up-cast
    const lvl = itemData.level;
    const consumeSpellMana =
      lvl > 0 && Number.isInteger(itemData.mana) && itemData.mana > 0;

    const consumeSpellSlot =
      lvl > 0 &&
      CONFIG.SdS.spellUpcastModes.includes(itemData.preparation.mode) &&
      !consumeSpellMana;
    // If can't upcast, return early and don't bother calculating available spell slots
    if (!consumeSpellSlot || !consumeSpellMana) {
      return foundry.utils.mergeObject(data, {
        isSpell: true,
        consumeSpellSlot,
        consumeSpellMana,
      });
    }

    // Determine the levels which are feasible
    let lmax = 0;
    const spellLevels = Array.fromRange(10)
      .reduce((arr, i) => {
        if (i < lvl) return arr;
        const label = CONFIG.SdS.spellLevels[i];
        const l = actorData.spells[`spell${i}`] || { max: 0, override: null };
        let max = parseInt(l.override || l.max || 0);
        let slots = Math.clamped(parseInt(l.value || 0), 0, max);
        if (max > 0) lmax = i;
        arr.push({
          level: i,
          label:
            i > 0
              ? game.i18n.format("SdS.SpellLevelSlot", {
                  level: label,
                  n: slots,
                })
              : label,
          canCast: max > 0,
          hasSlots: slots > 0,
        });
        return arr;
      }, [])
      .filter((sl) => sl.level <= lmax);

    // If this character has pact slots, present them as an option for casting the spell.
    const pact = actorData.spells.pact;
    if (pact.level >= lvl) {
      spellLevels.push({
        level: "pact",
        label: `${game.i18n.format("SdS.SpellLevelPact", {
          level: pact.level,
          n: pact.value,
        })}`,
        canCast: true,
        hasSlots: pact.value > 0,
      });
    }
    const canCast = spellLevels.some((l) => l.hasSlots);
    if (!canCast)
      data.errors.push(
        game.i18n.format("SdS.SpellCastNoSlots", {
          level: CONFIG.SdS.spellLevels[lvl],
          name: data.item.name,
        })
      );

    // Merge spell casting data
    return foundry.utils.mergeObject(data, {
      isSpell: true,
      consumeSpellSlot,
      consumeSpellMana,
      spellLevels,
    });
  }

  /* -------------------------------------------- */

  /**
   * Get the ability usage note that is displayed.
   * @param {object} item                                     Data for the item being used.
   * @param {{value: number, max: number, per: string}} uses  Object uses and recovery configuration.
   * @param {{charged: boolean, value: string}} recharge      Object recharge configuration.
   * @returns {string}                                        Localized string indicating available uses.
   * @private
   */
  static _getAbilityUseNote(item, uses, recharge) {
    // Zero quantity
    const quantity = item.system.quantity;
    if (quantity <= 0)
      return game.i18n.localize("SdS.AbilityUseUnavailableHint");

    // Abilities which use Recharge
    if (recharge.value) {
      return game.i18n.format(
        recharge.charged
          ? "SdS.AbilityUseChargedHint"
          : "SdS.AbilityUseRechargeHint",
        {
          type: game.i18n.localize(`ITEM.Type${item.type.capitalize()}`),
        }
      );
    }

    // Does not use any resource
    if (!uses.per || !uses.max) return "";

    // Consumables
    if (item.type === "consumable") {
      let str = "SdS.AbilityUseNormalHint";
      if (uses.value > 1) str = "SdS.AbilityUseConsumableChargeHint";
      else if (item.system.quantity === 1 && uses.autoDestroy)
        str = "SdS.AbilityUseConsumableDestroyHint";
      else if (item.system.quantity > 1)
        str = "SdS.AbilityUseConsumableQuantityHint";
      return game.i18n.format(str, {
        type: game.i18n.localize(
          `SdS.Consumable${item.system.consumableType.capitalize()}`
        ),
        value: uses.value,
        quantity: item.system.quantity,
        max: uses.max,
        per: CONFIG.SdS.limitedUsePeriods[uses.per],
      });
    }

    // Other Items
    else {
      return game.i18n.format("SdS.AbilityUseNormalHint", {
        type: game.i18n.localize(`ITEM.Type${item.type.capitalize()}`),
        value: uses.value,
        max: uses.max,
        per: CONFIG.SdS.limitedUsePeriods[uses.per],
      });
    }
  }
}

/**
 * Object describing the proficiency for a specific ability or skill.
 *
 * @param {number} proficiency   Actor's flat proficiency bonus based on their current level.
 * @param {number} multiplier    Value by which to multiply the actor's base proficiency value.
 * @param {boolean} [roundDown]  Should half-values be rounded up or down?
 */
class Proficiency {
  constructor(proficiency, multiplier, roundDown = true) {
    /**
     * Base proficiency value of the actor.
     * @type {number}
     * @private
     */
    this._baseProficiency = Number(proficiency ?? 0);

    /**
     * Value by which to multiply the actor's base proficiency value.
     * @type {number}
     */
    this.multiplier = Number(multiplier ?? 0);

    /**
     * Direction decimal results should be rounded ("up" or "down").
     * @type {string}
     */
    this.rounding = roundDown ? "down" : "up";
  }

  /* -------------------------------------------- */

  /**
   * Calculate an actor's proficiency modifier based on level or CR.
   * @param {number} level  Level or CR To use for calculating proficiency modifier.
   * @returns {number}      Proficiency modifier.
   */
  static calculateMod(level) {
    return Math.floor((level + 7) / 4);
  }

  /* -------------------------------------------- */

  /**
   * Flat proficiency value regardless of proficiency mode.
   * @type {number}
   */
  get flat() {
    const roundMethod = this.rounding === "down" ? Math.floor : Math.ceil;
    return roundMethod(this.multiplier * this._baseProficiency);
  }

  /* -------------------------------------------- */

  /**
   * Dice-based proficiency value regardless of proficiency mode.
   * @type {string}
   */
  get dice() {
    if (this._baseProficiency === 0 || this.multiplier === 0) return "0";
    const roundTerm = this.rounding === "down" ? "floor" : "ceil";
    if (this.multiplier === 0.5) {
      return `${roundTerm}(1d${this._baseProficiency * 2} / 2)`;
    } else {
      return `${this.multiplier}d${this._baseProficiency * 2}`;
    }
  }

  /* -------------------------------------------- */

  /**
   * Either flat or dice proficiency term based on configured setting.
   * @type {string}
   */
  get term() {
    return game.settings.get("sds", "proficiencyModifier") === "dice"
      ? this.dice
      : String(this.flat);
  }

  /* -------------------------------------------- */

  /**
   * Whether the proficiency is greater than zero.
   * @type {boolean}
   */
  get hasProficiency() {
    return this._baseProficiency > 0 && this.multiplier > 0;
  }

  /* -------------------------------------------- */

  /**
   * Override the default `toString` method to return flat proficiency for backwards compatibility in formula.
   * @returns {string}  Flat proficiency value.
   */
  toString() {
    return this.term;
  }
}

/**
 * Override and extend the basic Item implementation.
 */
class Item5e extends Item {
  /**
   * Caches an item linked to this one, such as a subclass associated with a class.
   * @type {Item5e}
   * @private
   */
  _classLink;

  /* -------------------------------------------- */
  /*  Item Properties                             */
  /* -------------------------------------------- */

  /**
   * Which ability score modifier is used by this item?
   * @type {string|null}
   */
  get abilityMod() {
    // Case 1 - defined directly by the item
    if (this.system.ability) return this.system.ability;

    // Case 2 - inferred from a parent actor
    if (this.actor && "abilities" in this.actor.system) {
      const abilities = this.actor.system.abilities;
      const spellcasting = this.actor.system.attributes.spellcasting;

      // Special rules per item type
      switch (this.type) {
        case "consumable":
          if (this.system.consumableType === "scroll")
            return spellcasting || "int";
          break;
        case "spell":
          return spellcasting || "int";
        case "tool":
          return "int";
        case "weapon":
          // Finesse weapons - Str or Dex (PHB pg. 147)
          if (this.system.properties.fin === true) {
            return abilities.dex.mod >= abilities.str.mod ? "dex" : "str";
          }
          // Ranged weapons - Dex (PH p.194)
          if (["simpleR", "martialR"].includes(this.system.weaponType))
            return "dex";
          break;
      }

      // If a specific attack type is defined
      if (this.hasAttack)
        return {
          mwak: "str",
          rwak: "dex",
          msak: spellcasting || "int",
          rsak: spellcasting || "int",
        }[this.system.actionType];
    }

    // Case 3 - unknown
    return null;
  }

  /* -------------------------------------------- */

  /**
   * Return an item's identifier.
   * @type {string}
   */
  get identifier() {
    return this.system.identifier || this.name.slugify({ strict: true });
  }

  /* -------------------------------------------- */

  /**
   * Does this item support advancement and have advancements defined?
   * @type {boolean}
   */
  get hasAdvancement() {
    return !!this.system.advancement?.length;
  }

  /* -------------------------------------------- */

  /**
   * Does the Item implement an attack roll as part of its usage?
   * @type {boolean}
   */
  get hasAttack() {
    return ["mwak", "rwak", "msak", "rsak"].includes(this.system.actionType);
  }

  /* -------------------------------------------- */

  /**
   * Does the Item implement a damage roll as part of its usage?
   * @type {boolean}
   */
  get hasDamage() {
    return !!(this.system.damage && this.system.damage.parts.length);
  }

  /* -------------------------------------------- */

  /**
   * Does the Item implement a versatile damage roll as part of its usage?
   * @type {boolean}
   */
  get isVersatile() {
    return !!(this.hasDamage && this.system.damage.versatile);
  }

  /* -------------------------------------------- */

  /**
   * Does the item provide an amount of healing instead of conventional damage?
   * @type {boolean}
   */
  get isHealing() {
    return this.system.actionType === "heal" && this.system.damage.parts.length;
  }

  /* -------------------------------------------- */

  /**
   * Is this class item the original class for the containing actor? If the item is not a class or it is not
   * embedded in an actor then this will return `null`.
   * @type {boolean|null}
   */
  get isOriginalClass() {
    if (this.type !== "class" || !this.isEmbedded) return null;
    return this.id === this.parent.system.details.originalClass;
  }

  /* -------------------------------------------- */

  /**
   * Class associated with this subclass. Always returns null on non-subclass or non-embedded items.
   * @type {Item5e|null}
   */
  get class() {
    if (!this.isEmbedded || this.type !== "subclass") return null;
    const cid = this.system.classIdentifier;
    return (this._classLink ??= this.parent.items.find(
      (i) => i.type === "class" && i.identifier === cid
    ));
  }

  /* -------------------------------------------- */

  /**
   * Subclass associated with this class. Always returns null on non-class or non-embedded items.
   * @type {Item5e|null}
   */
  get subclass() {
    if (!this.isEmbedded || this.type !== "class") return null;
    const items = this.parent.items;
    const cid = this.identifier;
    return (this._classLink ??= items.find(
      (i) => i.type === "subclass" && i.system.classIdentifier === cid
    ));
  }

  /* -------------------------------------------- */

  /**
   * Does the Item implement a saving throw as part of its usage?
   * @type {boolean}
   */
  get hasSave() {
    const save = this.system.save || {};
    return !!(save.ability && save.scaling);
  }

  /* --------------------------------------------- */

  /**
   * Does the Item implement an ability check as part of its usage?
   * @type {boolean}
   */
  get hasAbilityCheck() {
    return this.system.actionType === "abil" && this.system.ability;
  }

  /* -------------------------------------------- */

  /**
   * Does the Item have a target?
   * @type {boolean}
   */
  get hasTarget() {
    const target = this.system.target;
    return target && !["none", ""].includes(target.type);
  }

  /* -------------------------------------------- */

  /**
   * Does the Item have an area of effect target?
   * @type {boolean}
   */
  get hasAreaTarget() {
    const target = this.system.target;
    return target && target.type in CONFIG.SdS.areaTargetTypes;
  }

  /* -------------------------------------------- */

  /**
   * Is this Item limited in its ability to be used by charges or by recharge?
   * @type {boolean}
   */
  get hasLimitedUses() {
    let recharge = this.system.recharge || {};
    let uses = this.system.uses || {};
    return !!recharge.value || (uses.per && uses.max > 0);
  }

  /* -------------------------------------------- */

  /**
   * Is this item any of the armor subtypes?
   * @type {boolean}
   */
  get isArmor() {
    return this.system.armor?.type in CONFIG.SdS.armorTypes;
  }

  /* -------------------------------------------- */

  /**
   * Retrieve scale values for current level from advancement data.
   * @type {object}
   */
  get scaleValues() {
    if (
      !["class", "subclass"].includes(this.type) ||
      !this.advancement.byType.ScaleValue
    )
      return {};
    const level =
      this.type === "class"
        ? this.system.levels
        : this.class?.system.levels ?? 0;
    return this.advancement.byType.ScaleValue.reduce((obj, advancement) => {
      obj[advancement.identifier] = advancement.valueForLevel(level);
      return obj;
    }, {});
  }

  /* -------------------------------------------- */

  /**
   * Spellcasting details for a class or subclass.
   *
   * @typedef {object} SpellcastingDescription
   * @property {string} type              Spellcasting type as defined in ``CONFIG.SdS.spellcastingTypes`.
   * @property {string|null} progression  Progression within the specified spellcasting type if supported.
   * @property {string} ability           Ability used when casting spells from this class or subclass.
   * @property {number|null} levels       Number of levels of this class or subclass's class if embedded.
   */

  /**
   * Retrieve the spellcasting for a class or subclass. For classes, this will return the spellcasting
   * of the subclass if it overrides the class. For subclasses, this will return the class's spellcasting
   * if no spellcasting is defined on the subclass.
   * @type {SpellcastingDescription|null}  Spellcasting object containing progression & ability.
   */
  get spellcasting() {
    const spellcasting = this.system.spellcasting;
    if (!spellcasting) return null;
    const isSubclass = this.type === "subclass";
    const classSC = isSubclass ? this.class?.system.spellcasting : spellcasting;
    const subclassSC = isSubclass
      ? spellcasting
      : this.subclass?.system.spellcasting;
    const finalSC = foundry.utils.deepClone(
      subclassSC && subclassSC.progression !== "none" ? subclassSC : classSC
    );
    if (!finalSC) return null;
    finalSC.levels = this.isEmbedded
      ? this.system.levels ?? this.class?.system.levels
      : null;

    // Temp method for determining spellcasting type until this data is available directly using advancement
    if (CONFIG.SdS.spellcastingTypes[finalSC.progression])
      finalSC.type = finalSC.progression;
    else
      finalSC.type = Object.entries(CONFIG.SdS.spellcastingTypes).find(
        ([type, data]) => {
          return !!data.progression?.[finalSC.progression];
        }
      )?.[0];

    return finalSC;
  }

  /* -------------------------------------------- */

  /**
   * Should this item's active effects be suppressed.
   * @type {boolean}
   */
  get areEffectsSuppressed() {
    const requireEquipped =
      this.type !== "consumable" ||
      ["rod", "trinket", "wand"].includes(this.system.consumableType);
    if (requireEquipped && this.system.equipped === false) return true;
    return this.system.attunement === CONFIG.SdS.attunementTypes.REQUIRED;
  }

  /* -------------------------------------------- */
  /*  Data Preparation                            */
  /* -------------------------------------------- */

  /** @inheritDoc */
  prepareDerivedData() {
    super.prepareDerivedData();
    this.labels = {};

    // Clear out linked item cache
    this._classLink = undefined;

    // Advancement
    this._prepareAdvancement();

    // Specialized preparation per Item type
    switch (this.type) {
      case "equipment":
        this._prepareEquipment();
        break;
      case "feat":
        this._prepareFeat();
        break;
      case "spell":
        this._prepareSpell();
        break;
    }

    // Activated Items
    this._prepareActivation();
    this._prepareAction();

    // Un-owned items can have their final preparation done here, otherwise this needs to happen in the owning Actor
    if (!this.isOwned) this.prepareFinalAttributes();
  }

  /* -------------------------------------------- */

  /**
   * Prepare derived data for an equipment-type item and define labels.
   * @protected
   */
  _prepareEquipment() {
    this.labels.armor = this.system.armor.value
      ? `${this.system.armor.value} ${game.i18n.localize("SdS.AC")}`
      : "";
  }

  /* -------------------------------------------- */

  /**
   * Prepare derived data for a feat-type item and define labels.
   * @protected
   */
  _prepareFeat() {
    const act = this.system.activation;
    const types = CONFIG.SdS.abilityActivationTypes;
    if (act?.type === types.legendary)
      this.labels.featType = game.i18n.localize("SdS.LegendaryActionLabel");
    else if (act?.type === types.lair)
      this.labels.featType = game.i18n.localize("SdS.LairActionLabel");
    else if (act?.type) {
      this.labels.featType = game.i18n.localize(
        this.system.damage.length ? "SdS.Attack" : "SdS.Action"
      );
    } else this.labels.featType = game.i18n.localize("SdS.Passive");
  }

  /* -------------------------------------------- */

  /**
   * Prepare derived data for a spell-type item and define labels.
   * @protected
   */
  _prepareSpell() {
    const tags = Object.fromEntries(
      Object.entries(CONFIG.SdS.spellTags).map(([k, v]) => {
        v.tag = true;
        return [k, v];
      })
    );
    const attributes = { ...CONFIG.SdS.spellComponents, ...tags };
    this.system.preparation.mode ||= "prepared";
    this.labels.level = CONFIG.SdS.spellLevels[this.system.level];
    this.labels.schools = this.system.schools;
    this.labels.elements = this.system.elements;
    this.labels.mana = this.system.mana;
    this.labels.components = Object.entries(this.system.components).reduce(
      (obj, [c, active]) => {
        const config = attributes[c];
        if (!config || active !== true) return obj;
        obj.all.push({ abbr: config.abbr, tag: config.tag });
        if (config.tag) obj.tags.push(config.label);
        else obj.vsm.push(config.abbr);
        return obj;
      },
      { all: [], vsm: [], tags: [] }
    );
    this.labels.components.vsm = new Intl.ListFormat(game.i18n.lang, {
      style: "narrow",
      type: "conjunction",
    }).format(this.labels.components.vsm);
    this.labels.materials = this.system?.materials?.value ?? null;
  }

  /* -------------------------------------------- */

  /**
   * Prepare derived data for activated items and define labels.
   * @protected
   */
  _prepareActivation() {
    if (!("activation" in this.system)) return;
    const C = CONFIG.SdS;

    // Ability Activation Label
    const act = this.system.activation ?? {};
    if (["none", ""].includes(act.type)) act.type = null; // Backwards compatibility
    this.labels.activation = act.type
      ? [act.cost, C.abilityActivationTypes[act.type]].filterJoin(" ")
      : "";

    // Target Label
    let tgt = this.system.target ?? {};
    if (["none", ""].includes(tgt.type)) tgt.type = null; // Backwards compatibility
    if ([null, "self"].includes(tgt.type)) tgt.value = tgt.units = null;
    else if (tgt.units === "touch") tgt.value = null;
    this.labels.target = tgt.type
      ? [
          tgt.value,
          C.distanceUnits[tgt.units],
          C.targetTypes[tgt.type],
        ].filterJoin(" ")
      : "";

    // Range Label
    let rng = this.system.range ?? {};
    if (["none", ""].includes(rng.units)) rng.units = null; // Backwards compatibility
    if ([null, "touch", "self"].includes(rng.units))
      rng.value = rng.long = null;
    this.labels.range = rng.units
      ? [
          rng.value,
          rng.long ? `/ ${rng.long}` : null,
          C.distanceUnits[rng.units],
        ].filterJoin(" ")
      : "";

    // Recharge Label
    let chg = this.system.recharge ?? {};
    const chgSuffix = `${chg.value}${parseInt(chg.value) < 6 ? "+" : ""}`;
    this.labels.recharge = `${game.i18n.localize(
      "SdS.Recharge"
    )} [${chgSuffix}]`;
  }

  /* -------------------------------------------- */

  /**
   * Prepare derived data and labels for items which have an action which deals damage.
   * @protected
   */
  _prepareAction() {
    if (!("actionType" in this.system)) return;
    let dmg = this.system.damage || {};
    if (dmg.parts) {
      const types = CONFIG.SdS.damageTypes;
      this.labels.damage = dmg.parts
        .map((d) => d[0])
        .join(" + ")
        .replace(/\+ -/g, "- ");
      this.labels.damageTypes = dmg.parts.map((d) => types[d[1]]).join(", ");
    }
  }

  /* -------------------------------------------- */

  /**
   * Prepare advancement objects from stored advancement data.
   * @protected
   */
  _prepareAdvancement() {
    const minAdvancementLevel = ["class", "subclass"].includes(this.type)
      ? 1
      : 0;
    this.advancement = {
      byId: {},
      byLevel: Object.fromEntries(
        Array.fromRange(CONFIG.SdS.maxLevel + 1)
          .slice(minAdvancementLevel)
          .map((l) => [l, []])
      ),
      byType: {},
      needingConfiguration: [],
    };
    for (const advancement of this.system.advancement ?? []) {
      if (!(advancement instanceof Advancement$1)) continue;
      this.advancement.byId[advancement.id] = advancement;
      this.advancement.byType[advancement.type] ??= [];
      this.advancement.byType[advancement.type].push(advancement);
      advancement.levels.forEach((l) =>
        this.advancement.byLevel[l].push(advancement)
      );
      if (!advancement.levels.length)
        this.advancement.needingConfiguration.push(advancement);
    }
    Object.entries(this.advancement.byLevel).forEach(([lvl, data]) =>
      data.sort((a, b) => {
        return a
          .sortingValueForLevel(lvl)
          .localeCompare(b.sortingValueForLevel(lvl));
      })
    );
  }

  /* -------------------------------------------- */

  /**
   * Compute item attributes which might depend on prepared actor data. If this item is embedded this method will
   * be called after the actor's data is prepared.
   * Otherwise, it will be called at the end of `Item5e#prepareDerivedData`.
   */
  prepareFinalAttributes() {
    // Proficiency
    if (this.actor?.system.attributes?.prof) {
      const isProficient = this.type === "spell" || this.system.proficient; // Always proficient in spell attacks.
      this.system.prof = new Proficiency(
        this.actor?.system.attributes.prof,
        isProficient
      );
    }

    // Class data
    if (this.type === "class")
      this.system.isOriginalClass = this.isOriginalClass;

    // Action usage
    if ("actionType" in this.system) {
      this.labels.abilityCheck = game.i18n.format("SdS.AbilityPromptTitle", {
        ability: CONFIG.SdS.abilities[this.system.ability],
      });

      // Saving throws
      this.getSaveDC();

      // To Hit
      this.getAttackToHit();

      // Limited Uses
      this.prepareMaxUses();

      // Duration
      this.prepareDurationValue();

      // Damage Label
      this.getDerivedDamageLabel();
    }
  }

  /* -------------------------------------------- */

  /**
   * Populate a label with the compiled and simplified damage formula based on owned item
   * actor data. This is only used for display purposes and is not related to `Item5e#rollDamage`.
   * @returns {{damageType: string, formula: string, label: string}[]}
   */
  getDerivedDamageLabel() {
    if (!this.hasDamage || !this.isOwned) return [];
    const rollData = this.getRollData();
    const damageLabels = {
      ...CONFIG.SdS.damageTypes,
      ...CONFIG.SdS.healingTypes,
    };
    const derivedDamage = this.system.damage?.parts?.map((damagePart) => {
      let formula;
      try {
        const roll = new Roll(damagePart[0], rollData);
        formula = simplifyRollFormula(roll.formula, { preserveFlavor: true });
      } catch (err) {
        console.warn(`Unable to simplify formula for ${this.name}: ${err}`);
      }
      const damageType = damagePart[1];
      return {
        formula,
        damageType,
        label: `${formula} ${damageLabels[damageType] ?? ""}`,
      };
    });
    return (this.labels.derivedDamage = derivedDamage);
  }

  /* -------------------------------------------- */

  /**
   * Update the derived spell DC for an item that requires a saving throw.
   * @returns {number|null}
   */
  getSaveDC() {
    if (!this.hasSave) return null;
    const save = this.system.save;

    // Actor spell-DC based scaling
    if (save.scaling === "spell") {
      save.dc = this.isOwned ? this.actor.system.attributes.spelldc : null;
    }

    // Ability-score based scaling
    else if (save.scaling !== "flat") {
      save.dc = this.isOwned
        ? this.actor.system.abilities[save.scaling].dc
        : null;
    }

    // Update labels
    const abl = CONFIG.SdS.abilities[save.ability] ?? "";
    this.labels.save = game.i18n.format("SdS.SaveDC", {
      dc: save.dc || "",
      ability: abl,
    });
    return save.dc;
  }

  /* -------------------------------------------- */

  /**
   * Update a label to the Item detailing its total to hit bonus from the following sources:
   * - item document's innate attack bonus
   * - item's actor's proficiency bonus if applicable
   * - item's actor's global bonuses to the given item type
   * - item's ammunition if applicable
   * @returns {{rollData: object, parts: string[]}|null}  Data used in the item's Attack roll.
   */
  getAttackToHit() {
    if (!this.hasAttack) return null;
    const rollData = this.getRollData();
    const parts = [];

    // Include the item's innate attack bonus as the initial value and label
    const ab = this.system.attackBonus;
    if (ab) {
      parts.push(ab);
      this.labels.toHit = !/^[+-]/.test(ab) ? `+ ${ab}` : ab;
    }

    // Take no further action for un-owned items
    if (!this.isOwned) return { rollData, parts };

    // Ability score modifier
    parts.push("@mod");

    // Add proficiency bonus if an explicit proficiency flag is present or for non-item features
    if (
      !["weapon", "consumable"].includes(this.type) ||
      this.system.proficient
    ) {
      parts.push("@prof");
      if (this.system.prof?.hasProficiency)
        rollData.prof = this.system.prof.term;
    }

    // Actor-level global bonus to attack rolls
    const actorBonus =
      this.actor.system.bonuses?.[this.system.actionType] || {};
    if (actorBonus.attack) parts.push(actorBonus.attack);

    // One-time bonus provided by consumed ammunition
    if (this.system.consume?.type === "ammo" && this.actor.items) {
      const ammoItem = this.actor.items.get(this.system.consume.target);
      if (ammoItem) {
        const ammoItemQuantity = ammoItem.system.quantity;
        const ammoCanBeConsumed =
          ammoItemQuantity &&
          ammoItemQuantity - (this.system.consume.amount ?? 0) >= 0;
        const ammoItemAttackBonus = ammoItem.system.attackBonus;
        const ammoIsTypeConsumable =
          ammoItem.type === "consumable" &&
          ammoItem.system.consumableType === "ammo";
        if (ammoCanBeConsumed && ammoItemAttackBonus && ammoIsTypeConsumable) {
          parts.push("@ammo");
          rollData.ammo = ammoItemAttackBonus;
        }
      }
    }

    // Condense the resulting attack bonus formula into a simplified label
    const roll = new Roll(parts.join("+"), rollData);
    const formula = simplifyRollFormula(roll.formula) || "0";
    this.labels.toHit = !/^[+-]/.test(formula) ? `+ ${formula}` : formula;
    return { rollData, parts };
  }

  /* -------------------------------------------- */

  /**
   * Retrieve an item's critical hit threshold. Uses the smallest value from among the following sources:
   * - item document
   * - item document's actor (if it has one)
   * - item document's ammunition (if it has any)
   * - the constant '20'
   * @returns {number|null}  The minimum value that must be rolled to be considered a critical hit.
   */
  getCriticalThreshold() {
    const actorFlags = this.actor.flags.sds || {};
    if (!this.hasAttack) return null;
    let actorThreshold = null;
    let itemThreshold = this.system.critical?.threshold ?? Infinity;
    let ammoThreshold = Infinity;
    if (this.type === "weapon")
      actorThreshold = actorFlags.weaponCriticalThreshold;
    else if (this.type === "spell")
      actorThreshold = actorFlags.spellCriticalThreshold;
    if (this.system.consume?.type === "ammo") {
      ammoThreshold =
        this.actor.items.get(this.system.consume.target)?.system.critical
          .threshold ?? Infinity;
    }
    return Math.min(itemThreshold, ammoThreshold, actorThreshold ?? 20);
  }

  /* -------------------------------------------- */

  /**
   * Populates the max uses of an item.
   * If the item is an owned item and the `max` is not numeric, calculate based on actor data.
   */
  prepareMaxUses() {
    const uses = this.system.uses;
    if (!uses?.max) return;
    let max = uses.max;
    if (this.isOwned && !Number.isNumeric(max)) {
      const property = game.i18n.localize("SdS.UsesMax");
      try {
        const rollData = this.getRollData({ deterministic: true });
        max = Roll.safeEval(
          this.replaceFormulaData(max, rollData, { property })
        );
      } catch (e) {
        const message = game.i18n.format("SdS.FormulaMalformedError", {
          property,
          name: this.name,
        });
        this.actor._preparationWarnings.push({
          message,
          link: this.uuid,
          type: "error",
        });
        console.error(message, e);
        return;
      }
    }
    uses.max = Number(max);
  }

  /* -------------------------------------------- */

  /**
   * Populate the duration value of an item. If the item is an owned item and the
   * duration value is not numeric, calculate based on actor data.
   */
  prepareDurationValue() {
    const duration = this.system.duration;
    if (!duration?.value) return;
    let value = duration.value;

    // If this is an owned item and the value is not numeric, we need to calculate it
    if (this.isOwned && !Number.isNumeric(value)) {
      const property = game.i18n.localize("SdS.Duration");
      try {
        const rollData = this.getRollData({ deterministic: true });
        value = Roll.safeEval(
          this.replaceFormulaData(value, rollData, { property })
        );
      } catch (e) {
        const message = game.i18n.format("SdS.FormulaMalformedError", {
          property,
          name: this.name,
        });
        this.actor._preparationWarnings.push({
          message,
          link: this.uuid,
          type: "error",
        });
        console.error(message, e);
        return;
      }
    }
    duration.value = Number(value);

    // Now that duration value is a number, set the label
    if (["inst", "perm"].includes(duration.units)) duration.value = null;
    this.labels.duration = [
      duration.value,
      CONFIG.SdS.timePeriods[duration.units],
    ].filterJoin(" ");
  }

  /* -------------------------------------------- */

  /**
   * Replace referenced data attributes in the roll formula with values from the provided data.
   * If the attribute is not found in the provided data, display a warning on the actor.
   * @param {string} formula           The original formula within which to replace.
   * @param {object} data              The data object which provides replacements.
   * @param {object} options
   * @param {string} options.property  Name of the property to which this formula belongs.
   * @returns {string}                 Formula with replaced data.
   */
  replaceFormulaData(formula, data, { property }) {
    const dataRgx = new RegExp(/@([a-z.0-9_-]+)/gi);
    const missingReferences = new Set();
    formula = formula.replace(dataRgx, (match, term) => {
      let value = foundry.utils.getProperty(data, term);
      if (value == null) {
        missingReferences.add(match);
        return "0";
      }
      return String(value).trim();
    });
    if (missingReferences.size > 0 && this.actor) {
      const listFormatter = new Intl.ListFormat(game.i18n.lang, {
        style: "long",
        type: "conjunction",
      });
      const message = game.i18n.format("SdS.FormulaMissingReferenceWarn", {
        property,
        name: this.name,
        references: listFormatter.format(missingReferences),
      });
      this.actor._preparationWarnings.push({
        message,
        link: this.uuid,
        type: "warning",
      });
    }
    return formula;
  }

  /* -------------------------------------------- */

  /**
   * Configuration data for an item usage being prepared.
   *
   * @typedef {object} ItemUseConfiguration
   * @property {boolean} createMeasuredTemplate  Trigger a template creation
   * @property {boolean} consumeQuantity         Should the item's quantity be consumed?
   * @property {boolean} consumeRecharge         Should a recharge be consumed?
   * @property {boolean} consumeResource         Should a linked (non-ammo) resource be consumed?
   * @property {number|string|null} consumeSpellLevel  Specific spell level to consume, or "pact" for pact level.
   * @property {boolean} consumeSpellSlot        Should any spell slot be consumed?
   * @property {boolean} consumeUsage            Should limited uses be consumed?
   * @property {boolean} needsConfiguration      Is user-configuration needed?
   */

  /**
   * Additional options used for configuring item usage.
   *
   * @typedef {object} ItemUseOptions
   * @property {boolean} configureDialog  Display a configuration dialog for the item usage, if applicable?
   * @property {string} rollMode          The roll display mode with which to display (or not) the card.
   * @property {boolean} createMessage    Whether to automatically create a chat message (if true) or simply return
   *                                      the prepared chat message data (if false).
   * @property {object} flags             Additional flags added to the chat message.
   * @property {Event} event              The browser event which triggered the item usage, if any.
   */

  /**
   * Trigger an item usage, optionally creating a chat message with followup actions.
   * @param {ItemUseOptions} [options]           Options used for configuring item usage.
   * @returns {Promise<ChatMessage|object|void>} Chat message if options.createMessage is true, message data if it is
   *                                             false, and nothing if the roll wasn't performed.
   * @deprecated since 2.0 in favor of `Item5e#use`, targeted for removal in 2.4
   */
  async roll(options = {}) {
    foundry.utils.logCompatibilityWarning(
      "Item5e#roll has been renamed Item5e#use. Support for the old name will be removed in future versions.",
      { since: "SdS 2.0", until: "SdS 2.4" }
    );
    return this.use(undefined, options);
  }

  /**
   * Trigger an item usage, optionally creating a chat message with followup actions.
   * @param {ItemUseConfiguration} [config]      Initial configuration data for the usage.
   * @param {ItemUseOptions} [options]           Options used for configuring item usage.
   * @returns {Promise<ChatMessage|object|void>} Chat message if options.createMessage is true, message data if it is
   *                                             false, and nothing if the roll wasn't performed.
   */
  async use(config = {}, options = {}) {
    let item = this;
    const is = item.system;
    const as = item.actor.system;

    // Ensure the options object is ready
    options = foundry.utils.mergeObject(
      {
        configureDialog: true,
        createMessage: true,
        "flags.sds.use": {
          type: this.type,
          itemId: this.id,
          itemUuid: this.uuid,
        },
      },
      options
    );

    // Reference aspects of the item data necessary for usage
    const resource = is.consume || {}; // Resource consumption
    const isSpell = item.type === "spell"; // Does the item require a spell slot?

    const requireSpellMana =
      isSpell &&
      is.level > 0 &&
      Number.isInteger(item.system.mana) &&
      item.system.mana > 0;

    const requireSpellSlot =
      isSpell &&
      is.level > 0 &&
      CONFIG.SdS.spellUpcastModes.includes(is.preparation.mode) &&
      !requireSpellMana;

    // Define follow-up actions resulting from the item usage
    config = foundry.utils.mergeObject(
      {
        createMeasuredTemplate: item.hasAreaTarget,
        consumeQuantity: is.uses?.autoDestroy ?? false,
        consumeRecharge: !!is.recharge?.value,
        consumeResource:
          !!resource.target && (!item.hasAttack || resource.type !== "ammo"),
        consumeSpellLevel: requireSpellSlot
          ? is.preparation.mode === "pact"
            ? "pact"
            : is.level
          : null,
        consumeSpellSlot: requireSpellSlot,
        consumeSpellMana: requireSpellMana,
        consumeUsage: !!is.uses?.per && is.uses?.max > 0,
      },
      config
    );

    // Display a configuration dialog to customize the usage
    if (config.needsConfiguration === undefined)
      config.needsConfiguration =
        config.createMeasuredTemplate ||
        config.consumeRecharge ||
        config.consumeResource ||
        config.consumeSpellSlot ||
        config.consumeSpellMana ||
        config.consumeUsage;

    /**
     * A hook event that fires before an item usage is configured.
     * @function sds.preUseItem
     * @memberof hookEvents
     * @param {Item5e} item                  Item being used.
     * @param {ItemUseConfiguration} config  Configuration data for the item usage being prepared.
     * @param {ItemUseOptions} options       Additional options used for configuring item usage.
     * @returns {boolean}                    Explicitly return `false` to prevent item from being used.
     */
    if (Hooks.call("sds.preUseItem", item, config, options) === false) return;

    // Display configuration dialog
    if (options.configureDialog !== false && config.needsConfiguration) {
      const configuration = await AbilityUseDialog.create(item);
      if (!configuration) return;
      foundry.utils.mergeObject(config, configuration);
    }

    // Handle spell upcasting
    if (isSpell && (config.consumeSpellSlot || config.consumeSpellLevel)) {
      const upcastLevel =
        config.consumeSpellLevel === "pact"
          ? as.spells.pact.level
          : parseInt(config.consumeSpellLevel);
      if (upcastLevel && upcastLevel !== is.level) {
        item = item.clone({ "system.level": upcastLevel }, { keepId: true });
        item.prepareData();
        item.prepareFinalAttributes();
      }
    }
    if (isSpell)
      foundry.utils.mergeObject(options.flags, {
        "sds.use.spellLevel": item.system.level,
      });

    /**
     * A hook event that fires before an item's resource consumption has been calculated.
     * @function sds.preItemUsageConsumption
     * @memberof hookEvents
     * @param {Item5e} item                  Item being used.
     * @param {ItemUseConfiguration} config  Configuration data for the item usage being prepared.
     * @param {ItemUseOptions} options       Additional options used for configuring item usage.
     * @returns {boolean}                    Explicitly return `false` to prevent item from being used.
     */
    if (
      Hooks.call("sds.preItemUsageConsumption", item, config, options) === false
    )
      return;

    // Determine whether the item can be used by testing for resource consumption
    const usage = item._getUsageUpdates(config);
    if (!usage) return;

    /**
     * A hook event that fires after an item's resource consumption has been calculated but before any
     * changes have been made.
     * @function sds.itemUsageConsumption
     * @memberof hookEvents
     * @param {Item5e} item                     Item being used.
     * @param {ItemUseConfiguration} config     Configuration data for the item usage being prepared.
     * @param {ItemUseOptions} options          Additional options used for configuring item usage.
     * @param {object} usage
     * @param {object} usage.actorUpdates       Updates that will be applied to the actor.
     * @param {object} usage.itemUpdates        Updates that will be applied to the item being used.
     * @param {object[]} usage.resourceUpdates  Updates that will be applied to other items on the actor.
     * @returns {boolean}                       Explicitly return `false` to prevent item from being used.
     */
    if (
      Hooks.call("sds.itemUsageConsumption", item, config, options, usage) ===
      false
    )
      return;

    // Commit pending data updates
    const { actorUpdates, itemUpdates, resourceUpdates } = usage;
    if (!foundry.utils.isEmpty(itemUpdates)) await item.update(itemUpdates);
    if (config.consumeQuantity && item.system.quantity === 0)
      await item.delete();
    if (!foundry.utils.isEmpty(actorUpdates))
      await this.actor.update(actorUpdates);
    if (resourceUpdates.length)
      await this.actor.updateEmbeddedDocuments("Item", resourceUpdates);

    // Prepare card data & display it if options.createMessage is true
    const cardData = await item.displayCard(options);

    // Initiate measured template creation
    let templates;
    if (config.createMeasuredTemplate) {
      try {
        templates = await sds.canvas.AbilityTemplate.fromItem(
          item
        )?.drawPreview();
      } catch (err) {}
    }

    /**
     * A hook event that fires when an item is used, after the measured template has been created if one is needed.
     * @function sds.useItem
     * @memberof hookEvents
     * @param {Item5e} item                                Item being used.
     * @param {ItemUseConfiguration} config                Configuration data for the roll.
     * @param {ItemUseOptions} options                     Additional options for configuring item usage.
     * @param {MeasuredTemplateDocument[]|null} templates  The measured templates if they were created.
     */
    Hooks.callAll("sds.useItem", item, config, options, templates ?? null);

    return cardData;
  }

  /* -------------------------------------------- */

  /**
   * Verify that the consumed resources used by an Item are available and prepare the updates that should
   * be performed. If required resources are not available, display an error and return false.
   * @param {ItemUseConfiguration} config  Configuration data for an item usage being prepared.
   * @returns {object|boolean}             A set of data changes to apply when the item is used, or false.
   * @protected
   */
  _getUsageUpdates({
    consumeQuantity,
    consumeRecharge,
    consumeResource,
    consumeSpellSlot,
    consumeSpellMana,
    consumeSpellLevel,
    consumeUsage,
  }) {
    const actorUpdates = {};
    const itemUpdates = {};
    const resourceUpdates = [];

    // Consume Recharge
    if (consumeRecharge) {
      const recharge = this.system.recharge || {};
      if (recharge.charged === false) {
        ui.notifications.warn(
          game.i18n.format("SdS.ItemNoUses", { name: this.name })
        );
        return false;
      }
      itemUpdates["system.recharge.charged"] = false;
    }

    // Consume Limited Resource
    if (consumeResource) {
      const canConsume = this._handleConsumeResource(
        itemUpdates,
        actorUpdates,
        resourceUpdates
      );
      if (canConsume === false) return false;
    }

    if (consumeSpellMana) {
      const spellManaConsumption = Number(this.system.mana ?? 0);
      const actorMana = Number(this.actor?.system.attributes.mana.value ?? 0);
      const newActorMana = actorMana - spellManaConsumption;
      const hasSpellUseWorked = newActorMana >= 0;
      if (!hasSpellUseWorked) {
        ui.notifications.warn(
          game.i18n.format("SdS.NotEnoughMana", { name: this.name })
        );
        return false;
      }
      actorUpdates[`system.attributes.mana.value`] = newActorMana;
    }

    // Consume Spell Slots
    if (consumeSpellSlot && consumeSpellLevel) {
      if (Number.isNumeric(consumeSpellLevel))
        consumeSpellLevel = `spell${consumeSpellLevel}`;
      const level = this.actor?.system.spells[consumeSpellLevel];
      const spells = Number(level?.value ?? 0);
      if (spells === 0) {
        const labelKey =
          consumeSpellLevel === "pact"
            ? "SdS.SpellProgPact"
            : `SdS.SpellLevel${this.system.level}`;
        const label = game.i18n.localize(labelKey);
        ui.notifications.warn(
          game.i18n.format("SdS.SpellCastNoSlots", {
            name: this.name,
            level: label,
          })
        );
        return false;
      }
      actorUpdates[`system.spells.${consumeSpellLevel}.value`] = Math.max(
        spells - 1,
        0
      );
    }

    // Consume Limited Usage
    if (consumeUsage) {
      const uses = this.system.uses || {};
      const available = Number(uses.value ?? 0);
      let used = false;
      const remaining = Math.max(available - 1, 0);
      if (available >= 1) {
        used = true;
        itemUpdates["system.uses.value"] = remaining;
      }

      // Reduce quantity if not reducing usages or if usages hit zero, and we are set to consumeQuantity
      if (consumeQuantity && (!used || remaining === 0)) {
        const q = Number(this.system.quantity ?? 1);
        if (q >= 1) {
          used = true;
          itemUpdates["system.quantity"] = Math.max(q - 1, 0);
          itemUpdates["system.uses.value"] = uses.max ?? 1;
        }
      }

      // If the item was not used, return a warning
      if (!used) {
        ui.notifications.warn(
          game.i18n.format("SdS.ItemNoUses", { name: this.name })
        );
        return false;
      }
    }

    // Return the configured usage
    return { itemUpdates, actorUpdates, resourceUpdates };
  }

  /* -------------------------------------------- */

  /**
   * Handle update actions required when consuming an external resource
   * @param {object} itemUpdates        An object of data updates applied to this item
   * @param {object} actorUpdates       An object of data updates applied to the item owner (Actor)
   * @param {object[]} resourceUpdates  An array of updates to apply to other items owned by the actor
   * @returns {boolean|void}            Return false to block further progress, or return nothing to continue
   * @protected
   */
  _handleConsumeResource(itemUpdates, actorUpdates, resourceUpdates) {
    const consume = this.system.consume || {};
    if (!consume.type) return;

    // No consumed target
    const typeLabel = CONFIG.SdS.abilityConsumptionTypes[consume.type];
    if (!consume.target) {
      ui.notifications.warn(
        game.i18n.format("SdS.ConsumeWarningNoResource", {
          name: this.name,
          type: typeLabel,
        })
      );
      return false;
    }

    // Identify the consumed resource and its current quantity
    let resource = null;
    let amount = Number(consume.amount ?? 1);
    let quantity = 0;
    switch (consume.type) {
      case "attribute":
        resource = foundry.utils.getProperty(this.actor.system, consume.target);
        quantity = resource || 0;
        break;
      case "ammo":
      case "material":
        resource = this.actor.items.get(consume.target);
        quantity = resource ? resource.system.quantity : 0;
        break;
      case "hitDice":
        const denom = !["smallest", "largest"].includes(consume.target)
          ? consume.target
          : false;
        resource = Object.values(this.actor.classes).filter(
          (cls) => !denom || cls.system.hitDice === denom
        );
        quantity = resource.reduce(
          (count, cls) => count + cls.system.levels - cls.system.hitDiceUsed,
          0
        );
        break;
      case "charges":
        resource = this.actor.items.get(consume.target);
        if (!resource) break;
        const uses = resource.system.uses;
        if (uses.per && uses.max) quantity = uses.value;
        else if (resource.system.recharge?.value) {
          quantity = resource.system.recharge.charged ? 1 : 0;
          amount = 1;
        }
        break;
    }

    // Verify that a consumed resource is available
    if (resource === undefined) {
      ui.notifications.warn(
        game.i18n.format("SdS.ConsumeWarningNoSource", {
          name: this.name,
          type: typeLabel,
        })
      );
      return false;
    }

    // Verify that the required quantity is available
    let remaining = quantity - amount;
    if (remaining < 0) {
      ui.notifications.warn(
        game.i18n.format("SdS.ConsumeWarningNoQuantity", {
          name: this.name,
          type: typeLabel,
        })
      );
      return false;
    }

    // Define updates to provided data objects
    switch (consume.type) {
      case "attribute":
        actorUpdates[`system.${consume.target}`] = remaining;
        break;
      case "ammo":
      case "material":
        resourceUpdates.push({
          _id: consume.target,
          "system.quantity": remaining,
        });
        break;
      case "hitDice":
        if (["smallest", "largest"].includes(consume.target))
          resource = resource.sort((lhs, rhs) => {
            let sort = lhs.system.hitDice.localeCompare(
              rhs.system.hitDice,
              "en",
              { numeric: true }
            );
            if (consume.target === "largest") sort *= -1;
            return sort;
          });
        let toConsume = consume.amount;
        for (const cls of resource) {
          const available =
            (toConsume > 0 ? cls.system.levels : 0) - cls.system.hitDiceUsed;
          const delta =
            toConsume > 0
              ? Math.min(toConsume, available)
              : Math.max(toConsume, available);
          if (delta !== 0) {
            resourceUpdates.push({
              _id: cls.id,
              "system.hitDiceUsed": cls.system.hitDiceUsed + delta,
            });
            toConsume -= delta;
            if (toConsume === 0) break;
          }
        }
        break;
      case "charges":
        const uses = resource.system.uses || {};
        const recharge = resource.system.recharge || {};
        const update = { _id: consume.target };
        if (uses.per && uses.max) update["system.uses.value"] = remaining;
        else if (recharge.value) update["system.recharge.charged"] = false;
        resourceUpdates.push(update);
        break;
    }
  }

  /* -------------------------------------------- */

  /**
   * Display the chat card for an Item as a Chat Message
   * @param {ItemUseOptions} [options]  Options which configure the display of the item chat card.
   * @returns {ChatMessage|object}      Chat message if `createMessage` is true, otherwise an object containing
   *                                    message data.
   */
  async displayCard(options = {}) {
    // Render the chat card template
    const token = this.actor.token;
    const templateData = {
      actor: this.actor,
      tokenId: token?.uuid || null,
      item: this,
      data: await this.getChatData(),
      labels: this.labels,
      hasAttack: this.hasAttack,
      isHealing: this.isHealing,
      hasDamage: this.hasDamage,
      isVersatile: this.isVersatile,
      isSpell: this.type === "spell",
      hasSave: this.hasSave,
      hasAreaTarget: this.hasAreaTarget,
      isTool: this.type === "tool",
      hasAbilityCheck: this.hasAbilityCheck,
    };
    const html = await renderTemplate(
      "systems/sds/templates/chat/item-card.hbs",
      templateData
    );

    // Create the ChatMessage data object
    const chatData = {
      user: game.user.id,
      type: CONST.CHAT_MESSAGE_TYPES.OTHER,
      content: html,
      flavor: this.system.chatFlavor || this.name,
      speaker: ChatMessage.getSpeaker({ actor: this.actor, token }),
      flags: { "core.canPopout": true },
    };

    // If the Item was destroyed in the process of displaying its card - embed the item data in the chat message
    if (this.type === "consumable" && !this.actor.items.has(this.id)) {
      chatData.flags["sds.itemData"] = templateData.item.toObject();
    }

    // Merge in the flags from options
    chatData.flags = foundry.utils.mergeObject(chatData.flags, options.flags);

    /**
     * A hook event that fires before an item chat card is created.
     * @function sds.preDisplayCard
     * @memberof hookEvents
     * @param {Item5e} item             Item for which the chat card is being displayed.
     * @param {object} chatData         Data used to create the chat message.
     * @param {ItemUseOptions} options  Options which configure the display of the item chat card.
     */
    Hooks.callAll("sds.preDisplayCard", this, chatData, options);

    // Apply the roll mode to adjust message visibility
    ChatMessage.applyRollMode(
      chatData,
      options.rollMode ?? game.settings.get("core", "rollMode")
    );

    // Create the Chat Message or return its data
    const card =
      options.createMessage !== false
        ? await ChatMessage.create(chatData)
        : chatData;

    /**
     * A hook event that fires after an item chat card is created.
     * @function sds.displayCard
     * @memberof hookEvents
     * @param {Item5e} item              Item for which the chat card is being displayed.
     * @param {ChatMessage|object} card  The created ChatMessage instance or ChatMessageData depending on whether
     *                                   options.createMessage was set to `true`.
     */
    Hooks.callAll("sds.displayCard", this, card);

    return card;
  }

  /* -------------------------------------------- */
  /*  Chat Cards                                  */
  /* -------------------------------------------- */

  /**
   * Prepare an object of chat data used to display a card for the Item in the chat log.
   * @param {object} htmlOptions    Options used by the TextEditor.enrichHTML function.
   * @returns {object}              An object of chat data to render.
   */
  async getChatData(htmlOptions = {}) {
    const data = this.toObject().system;
    const labels = this.labels;

    // Rich text description
    data.description.value = await TextEditor.enrichHTML(
      data.description.value,
      {
        async: true,
        relativeTo: this,
        rollData: this.getRollData(),
        ...htmlOptions,
      }
    );

    // Item type specific properties
    const props = [];
    switch (this.type) {
      case "consumable":
        this._consumableChatData(data, labels, props);
        break;
      case "equipment":
        this._equipmentChatData(data, labels, props);
        break;
      case "feat":
        this._featChatData(data, labels, props);
        break;
      case "loot":
        this._lootChatData(data, labels, props);
        break;
      case "spell":
        this._spellChatData(data, labels, props);
        break;
      case "tool":
        this._toolChatData(data, labels, props);
        break;
      case "weapon":
        this._weaponChatData(data, labels, props);
        break;
    }

    // Equipment properties
    if (
      data.hasOwnProperty("equipped") &&
      !["loot", "tool"].includes(this.type)
    ) {
      if (data.attunement === CONFIG.SdS.attunementTypes.REQUIRED) {
        props.push(CONFIG.SdS.attunements[CONFIG.SdS.attunementTypes.REQUIRED]);
      }
      props.push(
        game.i18n.localize(data.equipped ? "SdS.Equipped" : "SdS.Unequipped"),
        game.i18n.localize(
          data.proficient ? "SdS.Proficient" : "SdS.NotProficient"
        )
      );
    }

    // Ability activation properties
    if (data.hasOwnProperty("activation")) {
      props.push(
        labels.activation +
          (data.activation?.condition ? ` (${data.activation.condition})` : ""),
        labels.target,
        labels.range,
        labels.duration
      );
    }

    // Filter properties and return
    data.properties = props.filter((p) => !!p);
    return data;
  }

  /* -------------------------------------------- */

  /**
   * Prepare chat card data for consumable type items.
   * @param {object} data     Copy of item data being use to display the chat message.
   * @param {object} labels   Specially prepared item labels.
   * @param {string[]} props  Existing list of properties to be displayed. *Will be mutated.*
   * @private
   */
  _consumableChatData(data, labels, props) {
    props.push(
      CONFIG.SdS.consumableTypes[data.consumableType],
      `${data.uses.value}/${data.uses.max} ${game.i18n.localize("SdS.Charges")}`
    );
    data.hasCharges = data.uses.value >= 0;
  }

  /* -------------------------------------------- */

  /**
   * Prepare chat card data for equipment type items.
   * @param {object} data     Copy of item data being use to display the chat message.
   * @param {object} labels   Specially prepared item labels.
   * @param {string[]} props  Existing list of properties to be displayed. *Will be mutated.*
   * @private
   */
  _equipmentChatData(data, labels, props) {
    props.push(
      CONFIG.SdS.equipmentTypes[data.armor.type],
      labels.armor || null,
      data.stealth ? game.i18n.localize("SdS.StealthDisadvantage") : null
    );
  }

  /* -------------------------------------------- */

  /**
   * Prepare chat card data for items of the Feat type.
   * @param {object} data     Copy of item data being use to display the chat message.
   * @param {object} labels   Specially prepared item labels.
   * @param {string[]} props  Existing list of properties to be displayed. *Will be mutated.*
   * @private
   */
  _featChatData(data, labels, props) {
    props.push(data.requirements);
  }

  /* -------------------------------------------- */

  /**
   * Prepare chat card data for loot type items.
   * @param {object} data     Copy of item data being use to display the chat message.
   * @param {object} labels   Specially prepared item labels.
   * @param {string[]} props  Existing list of properties to be displayed. *Will be mutated.*
   * @private
   */
  _lootChatData(data, labels, props) {
    props.push(
      game.i18n.localize("ITEM.TypeLoot"),
      data.weight
        ? `${data.weight} ${game.i18n.localize("SdS.AbbreviationLbs")}`
        : null
    );
  }

  /* -------------------------------------------- */

  /**
   * Render a chat card for Spell type data.
   * @param {object} data     Copy of item data being use to display the chat message.
   * @param {object} labels   Specially prepared item labels.
   * @param {string[]} props  Existing list of properties to be displayed. *Will be mutated.*
   * @private
   */
  _spellChatData(data, labels, props) {
    props.push(
      labels.level,
      labels.components.vsm +
        (labels.materials ? ` (${labels.materials})` : ""),
      ...labels.components.tags
    );
  }

  /* -------------------------------------------- */

  /**
   * Prepare chat card data for tool type items.
   * @param {object} data     Copy of item data being use to display the chat message.
   * @param {object} labels   Specially prepared item labels.
   * @param {string[]} props  Existing list of properties to be displayed. *Will be mutated.*
   * @private
   */
  _toolChatData(data, labels, props) {
    props.push(
      CONFIG.SdS.abilities[data.ability] || null,
      CONFIG.SdS.proficiencyLevels[data.proficient || 0]
    );
  }

  /* -------------------------------------------- */

  /**
   * Prepare chat card data for weapon type items.
   * @param {object} data     Copy of item data being use to display the chat message.
   * @param {object} labels   Specially prepared item labels.
   * @param {string[]} props  Existing list of properties to be displayed. *Will be mutated.*
   * @private
   */
  _weaponChatData(data, labels, props) {
    props.push(CONFIG.SdS.weaponTypes[data.weaponType]);
  }

  /* -------------------------------------------- */
  /*  Item Rolls - Attack, Damage, Saves, Checks  */
  /* -------------------------------------------- */

  /**
   * Place an attack roll using an item (weapon, feat, spell, or equipment)
   * Rely upon the d20Roll logic for the core implementation
   *
   * @param {D20RollConfiguration} options  Roll options which are configured and provided to the d20Roll function
   * @returns {Promise<D20Roll|null>}       A Promise which resolves to the created Roll instance
   */
  async rollAttack(options = {}) {
    const flags = this.actor.flags.sds ?? {};
    if (!this.hasAttack)
      throw new Error("You may not place an Attack Roll with this Item.");
    let title = `${this.name} - ${game.i18n.localize("SdS.AttackRoll")}`;

    // Get the parts and rollData for this item's attack
    const { parts, rollData } = this.getAttackToHit();
    if (options.spellLevel) rollData.item.level = options.spellLevel;

    // Handle ammunition consumption
    delete this._ammo;
    let ammo = null;
    let ammoUpdate = [];
    const consume = this.system.consume;
    if (consume?.type === "ammo") {
      ammo = this.actor.items.get(consume.target);
      if (ammo?.system) {
        const q = ammo.system.quantity;
        const consumeAmount = consume.amount ?? 0;
        if (q && q - consumeAmount >= 0) {
          this._ammo = ammo;
          title += ` [${ammo.name}]`;
        }
      }

      // Get pending ammunition update
      const usage = this._getUsageUpdates({ consumeResource: true });
      if (usage === false) return null;
      ammoUpdate = usage.resourceUpdates ?? [];
    }

    // Flags
    const elvenAccuracy =
      (flags.elvenAccuracy &&
        CONFIG.SdS.characterFlags.elvenAccuracy.abilities.includes(
          this.abilityMod
        )) ||
      undefined;

    // Compose roll options
    const rollConfig = foundry.utils.mergeObject(
      {
        actor: this.actor,
        data: rollData,
        critical: this.getCriticalThreshold(),
        title,
        flavor: title,
        elvenAccuracy,
        halflingLucky: flags.halflingLucky,
        dialogOptions: {
          width: 400,
          top: options.event ? options.event.clientY - 80 : null,
          left: window.innerWidth - 710,
        },
        messageData: {
          "flags.sds.roll": {
            type: "attack",
            itemId: this.id,
            itemUuid: this.uuid,
          },
          speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        },
      },
      options
    );
    rollConfig.parts = parts.concat(options.parts ?? []);

    /**
     * A hook event that fires before an attack is rolled for an Item.
     * @function sds.preRollAttack
     * @memberof hookEvents
     * @param {Item5e} item                  Item for which the roll is being performed.
     * @param {D20RollConfiguration} config  Configuration data for the pending roll.
     * @returns {boolean}                    Explicitly return false to prevent the roll from being performed.
     */
    if (Hooks.call("sds.preRollAttack", this, rollConfig) === false) return;

    const roll = await d20Roll(rollConfig);
    if (roll === null) return null;

    /**
     * A hook event that fires after an attack has been rolled for an Item.
     * @function sds.rollAttack
     * @memberof hookEvents
     * @param {Item5e} item          Item for which the roll was performed.
     * @param {D20Roll} roll         The resulting roll.
     * @param {object[]} ammoUpdate  Updates that will be applied to ammo Items as a result of this attack.
     */
    Hooks.callAll("sds.rollAttack", this, roll, ammoUpdate);

    // Commit ammunition consumption on attack rolls resource consumption if the attack roll was made
    if (ammoUpdate.length)
      await this.actor?.updateEmbeddedDocuments("Item", ammoUpdate);
    return roll;
  }

  /* -------------------------------------------- */

  /**
   * Place a damage roll using an item (weapon, feat, spell, or equipment)
   * Rely upon the damageRoll logic for the core implementation.
   * @param {object} [config]
   * @param {MouseEvent} [config.event]    An event which triggered this roll, if any
   * @param {boolean} [config.critical]    Should damage be rolled as a critical hit?
   * @param {number} [config.spellLevel]   If the item is a spell, override the level for damage scaling
   * @param {boolean} [config.versatile]   If the item is a weapon, roll damage using the versatile formula
   * @param {DamageRollConfiguration} [config.options]  Additional options passed to the damageRoll function
   * @returns {Promise<DamageRoll>}        A Promise which resolves to the created Roll instance, or null if the action
   *                                       cannot be performed.
   */
  async rollDamage({
    critical,
    event = null,
    spellLevel = null,
    versatile = false,
    options = {},
  } = {}) {
    if (!this.hasDamage)
      throw new Error("You may not make a Damage Roll with this Item.");
    const messageData = {
      "flags.sds.roll": {
        type: "damage",
        itemId: this.id,
        itemUuid: this.uuid,
      },
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
    };

    // Get roll data
    const dmg = this.system.damage;
    const parts = dmg.parts.map((d) => d[0]);
    const rollData = this.getRollData();
    if (spellLevel) rollData.item.level = spellLevel;

    // Configure the damage roll
    const actionFlavor = game.i18n.localize(
      this.system.actionType === "heal" ? "SdS.Healing" : "SdS.DamageRoll"
    );
    const title = `${this.name} - ${actionFlavor}`;
    const rollConfig = {
      actor: this.actor,
      critical,
      data: rollData,
      event,
      title: title,
      flavor: this.labels.damageTypes.length
        ? `${title} (${this.labels.damageTypes})`
        : title,
      dialogOptions: {
        width: 400,
        top: event ? event.clientY - 80 : null,
        left: window.innerWidth - 710,
      },
      messageData,
    };

    // Adjust damage from versatile usage
    if (versatile && dmg.versatile) {
      parts[0] = dmg.versatile;
      messageData["flags.sds.roll"].versatile = true;
    }

    // Scale damage from up-casting spells
    const scaling = this.system.scaling;
    if (this.type === "spell") {
      if (scaling.mode === "cantrip") {
        let level;
        if (this.actor.type === "character")
          level = this.actor.system.details.level;
        else if (this.system.preparation.mode === "innate")
          level = Math.ceil(this.actor.system.details.cr);
        else level = this.actor.system.details.spellLevel;
        this._scaleCantripDamage(parts, scaling.formula, level, rollData);
      } else if (spellLevel && scaling.mode === "level" && scaling.formula) {
        this._scaleSpellDamage(
          parts,
          this.system.level,
          spellLevel,
          scaling.formula,
          rollData
        );
      }
    }

    // Add damage bonus formula
    const actorBonus =
      foundry.utils.getProperty(
        this.actor.system,
        `bonuses.${this.system.actionType}`
      ) || {};
    if (actorBonus.damage && parseInt(actorBonus.damage) !== 0) {
      parts.push(actorBonus.damage);
    }

    // Only add the ammunition damage if the ammunition is a consumable with type 'ammo'
    if (
      this._ammo &&
      this._ammo.type === "consumable" &&
      this._ammo.system.consumableType === "ammo"
    ) {
      parts.push("@ammo");
      rollData.ammo = this._ammo.system.damage.parts.map((p) => p[0]).join("+");
      rollConfig.flavor += ` [${this._ammo.name}]`;
      delete this._ammo;
    }

    // Factor in extra critical damage dice from the Barbarian's "Brutal Critical"
    if (this.system.actionType === "mwak") {
      rollConfig.criticalBonusDice =
        this.actor.getFlag("sds", "meleeCriticalDamageDice") ?? 0;
    }

    // Factor in extra weapon-specific critical damage
    if (this.system.critical?.damage)
      rollConfig.criticalBonusDamage = this.system.critical.damage;

    foundry.utils.mergeObject(rollConfig, options);
    rollConfig.parts = parts.concat(options.parts ?? []);

    /**
     * A hook event that fires before a damage is rolled for an Item.
     * @function sds.preRollDamage
     * @memberof hookEvents
     * @param {Item5e} item                     Item for which the roll is being performed.
     * @param {DamageRollConfiguration} config  Configuration data for the pending roll.
     * @returns {boolean}                       Explicitly return false to prevent the roll from being performed.
     */
    if (Hooks.call("sds.preRollDamage", this, rollConfig) === false) return;

    const roll = await damageRoll(rollConfig);

    /**
     * A hook event that fires after a damage has been rolled for an Item.
     * @function sds.rollDamage
     * @memberof hookEvents
     * @param {Item5e} item      Item for which the roll was performed.
     * @param {DamageRoll} roll  The resulting roll.
     */
    if (roll) Hooks.callAll("sds.rollDamage", this, roll);

    // Call the roll helper utility
    return roll;
  }

  /* -------------------------------------------- */

  /**
   * Adjust a cantrip damage formula to scale it for higher level characters and monsters.
   * @param {string[]} parts   The original parts of the damage formula.
   * @param {string} scale     The scaling formula.
   * @param {number} level     Level at which the spell is being cast.
   * @param {object} rollData  A data object that should be applied to the scaled damage roll.
   * @returns {string[]}       The parts of the damage formula with the scaling applied.
   * @private
   */
  _scaleCantripDamage(parts, scale, level, rollData) {
    const add = Math.floor((level + 1) / 6);
    if (add === 0) return [];
    return this._scaleDamage(parts, scale || parts.join(" + "), add, rollData);
  }

  /* -------------------------------------------- */

  /**
   * Adjust the spell damage formula to scale it for spell level up-casting.
   * @param {string[]} parts      The original parts of the damage formula.
   * @param {number} baseLevel    Default level for the spell.
   * @param {number} spellLevel   Level at which the spell is being cast.
   * @param {string} formula      The scaling formula.
   * @param {object} rollData     A data object that should be applied to the scaled damage roll.
   * @returns {string[]}          The parts of the damage formula with the scaling applied.
   * @private
   */
  _scaleSpellDamage(parts, baseLevel, spellLevel, formula, rollData) {
    const upcastLevels = Math.max(spellLevel - baseLevel, 0);
    if (upcastLevels === 0) return parts;
    return this._scaleDamage(parts, formula, upcastLevels, rollData);
  }

  /* -------------------------------------------- */

  /**
   * Scale an array of damage parts according to a provided scaling formula and scaling multiplier.
   * @param {string[]} parts    The original parts of the damage formula.
   * @param {string} scaling    The scaling formula.
   * @param {number} times      A number of times to apply the scaling formula.
   * @param {object} rollData   A data object that should be applied to the scaled damage roll
   * @returns {string[]}        The parts of the damage formula with the scaling applied.
   * @private
   */
  _scaleDamage(parts, scaling, times, rollData) {
    if (times <= 0) return parts;
    const p0 = new Roll(parts[0], rollData);
    const s = new Roll(scaling, rollData).alter(times);

    // Attempt to simplify by combining like dice terms
    let simplified = false;
    if (s.terms[0] instanceof Die && s.terms.length === 1) {
      const d0 = p0.terms[0];
      const s0 = s.terms[0];
      if (
        d0 instanceof Die &&
        d0.faces === s0.faces &&
        d0.modifiers.equals(s0.modifiers)
      ) {
        d0.number += s0.number;
        parts[0] = p0.formula;
        simplified = true;
      }
    }

    // Otherwise, add to the first part
    if (!simplified) parts[0] = `${parts[0]} + ${s.formula}`;
    return parts;
  }

  /* -------------------------------------------- */

  /**
   * Prepare data needed to roll an attack using an item (weapon, feat, spell, or equipment)
   * and then pass it off to `d20Roll`.
   * @param {object} [options]
   * @param {boolean} [options.spellLevel]  Level at which a spell is cast.
   * @returns {Promise<Roll>}   A Promise which resolves to the created Roll instance.
   */
  async rollFormula({ spellLevel } = {}) {
    if (!this.system.formula)
      throw new Error("This Item does not have a formula to roll!");

    const rollConfig = {
      formula: this.system.formula,
      data: this.getRollData(),
      chatMessage: true,
    };
    if (spellLevel) rollConfig.data.item.level = spellLevel;

    /**
     * A hook event that fires before a formula is rolled for an Item.
     * @function sds.preRollFormula
     * @memberof hookEvents
     * @param {Item5e} item                 Item for which the roll is being performed.
     * @param {object} config               Configuration data for the pending roll.
     * @param {string} config.formula       Formula that will be rolled.
     * @param {object} config.data          Data used when evaluating the roll.
     * @param {boolean} config.chatMessage  Should a chat message be created for this roll?
     * @returns {boolean}                   Explicitly return false to prevent the roll from being performed.
     */
    if (Hooks.call("sds.preRollFormula", this, rollConfig) === false) return;

    const roll = await new Roll(rollConfig.formula, rollConfig.data).roll({
      async: true,
    });

    if (rollConfig.chatMessage) {
      roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        flavor: `${this.name} - ${game.i18n.localize("SdS.OtherFormula")}`,
        rollMode: game.settings.get("core", "rollMode"),
        messageData: {
          "flags.sds.roll": {
            type: "other",
            itemId: this.id,
            itemUuid: this.uuid,
          },
        },
      });
    }

    /**
     * A hook event that fires after a formula has been rolled for an Item.
     * @function sds.rollFormula
     * @memberof hookEvents
     * @param {Item5e} item  Item for which the roll was performed.
     * @param {Roll} roll    The resulting roll.
     */
    Hooks.callAll("sds.rollFormula", this, roll);

    return roll;
  }

  /* -------------------------------------------- */

  /**
   * Perform an ability recharge test for an item which uses the d6 recharge mechanic.
   * @returns {Promise<Roll>}   A Promise which resolves to the created Roll instance
   */
  async rollRecharge() {
    const recharge = this.system.recharge ?? {};
    if (!recharge.value) return;

    const rollConfig = {
      formula: "1d6",
      data: this.getRollData(),
      target: parseInt(recharge.value),
      chatMessage: true,
    };

    /**
     * A hook event that fires before the Item is rolled to recharge.
     * @function sds.preRollRecharge
     * @memberof hookEvents
     * @param {Item5e} item                 Item for which the roll is being performed.
     * @param {object} config               Configuration data for the pending roll.
     * @param {string} config.formula       Formula that will be used to roll the recharge.
     * @param {object} config.data          Data used when evaluating the roll.
     * @param {number} config.target        Total required to be considered recharged.
     * @param {boolean} config.chatMessage  Should a chat message be created for this roll?
     * @returns {boolean}                   Explicitly return false to prevent the roll from being performed.
     */
    if (Hooks.call("sds.preRollRecharge", this, rollConfig) === false) return;

    const roll = await new Roll(rollConfig.formula, rollConfig.data).roll({
      async: true,
    });
    const success = roll.total >= rollConfig.target;

    if (rollConfig.chatMessage) {
      const resultMessage = game.i18n.localize(
        `SdS.ItemRecharge${success ? "Success" : "Failure"}`
      );
      roll.toMessage({
        flavor: `${game.i18n.format("SdS.ItemRechargeCheck", {
          name: this.name,
        })} - ${resultMessage}`,
        speaker: ChatMessage.getSpeaker({
          actor: this.actor,
          token: this.actor.token,
        }),
      });
    }

    /**
     * A hook event that fires after the Item has rolled to recharge, but before any changes have been performed.
     * @function sds.rollRecharge
     * @memberof hookEvents
     * @param {Item5e} item  Item for which the roll was performed.
     * @param {Roll} roll    The resulting roll.
     * @returns {boolean}    Explicitly return false to prevent the item from being recharged.
     */
    if (Hooks.call("sds.rollRecharge", this, roll) === false) return roll;

    // Update the Item data
    if (success) this.update({ "system.recharge.charged": true });

    return roll;
  }

  /* -------------------------------------------- */

  /**
   * Prepare data needed to roll a tool check and then pass it off to `d20Roll`.
   * @param {D20RollConfiguration} [options]  Roll configuration options provided to the d20Roll function.
   * @returns {Promise<Roll>}                 A Promise which resolves to the created Roll instance.
   */
  async rollToolCheck(options = {}) {
    if (this.type !== "tool") throw new Error("Wrong item type!");

    // Prepare roll data
    const rollData = this.getRollData();
    const abl = this.system.ability;
    const parts = ["@mod", "@abilityCheckBonus"];
    const title = `${this.name} - ${game.i18n.localize("SdS.ToolCheck")}`;

    // Add proficiency
    if (this.system.prof?.hasProficiency) {
      parts.push("@prof");
      rollData.prof = this.system.prof.term;
    }

    // Add tool bonuses
    if (this.system.bonus) {
      parts.push("@toolBonus");
      rollData.toolBonus = Roll.replaceFormulaData(this.system.bonus, rollData);
    }

    // Add ability-specific check bonus
    const checkBonus = foundry.utils.getProperty(
      rollData,
      `abilities.${abl}.bonuses.check`
    );
    if (checkBonus)
      rollData.abilityCheckBonus = Roll.replaceFormulaData(
        checkBonus,
        rollData
      );
    else rollData.abilityCheckBonus = 0;

    // Add global actor bonus
    const globalBonus = this.actor.system.bonuses?.abilities || {};
    if (globalBonus.check) {
      parts.push("@checkBonus");
      rollData.checkBonus = Roll.replaceFormulaData(
        globalBonus.check,
        rollData
      );
    }

    // Compose the roll data
    const rollConfig = foundry.utils.mergeObject(
      {
        data: rollData,
        title: title,
        flavor: title,
        dialogOptions: {
          width: 400,
          top: options.event ? options.event.clientY - 80 : null,
          left: window.innerWidth - 710,
        },
        chooseModifier: true,
        halflingLucky: this.actor.getFlag("sds", "halflingLucky"),
        reliableTalent:
          this.system.proficient >= 1 &&
          this.actor.getFlag("sds", "reliableTalent"),
        messageData: {
          speaker:
            options.speaker || ChatMessage.getSpeaker({ actor: this.actor }),
          "flags.sds.roll": {
            type: "tool",
            itemId: this.id,
            itemUuid: this.uuid,
          },
        },
      },
      options
    );
    rollConfig.parts = parts.concat(options.parts ?? []);

    /**
     * A hook event that fires before a tool check is rolled for an Item.
     * @function sds.preRollToolCheck
     * @memberof hookEvents
     * @param {Item5e} item                  Item for which the roll is being performed.
     * @param {D20RollConfiguration} config  Configuration data for the pending roll.
     * @returns {boolean}                    Explicitly return false to prevent the roll from being performed.
     */
    if (Hooks.call("sds.preRollToolCheck", this, rollConfig) === false) return;

    const roll = await d20Roll(rollConfig);

    /**
     * A hook event that fires after a tool check has been rolled for an Item.
     * @function sds.rollToolCheck
     * @memberof hookEvents
     * @param {Item5e} item   Item for which the roll was performed.
     * @param {D20Roll} roll  The resulting roll.
     */
    if (roll) Hooks.callAll("sds.rollToolCheck", this, roll);

    return roll;
  }

  /* -------------------------------------------- */

  /**
   * @inheritdoc
   * @param {object} [options]
   * @param {boolean} [options.deterministic] Whether to force deterministic values for data properties that could be
   *                                          either a die term or a flat term.
   */
  getRollData({ deterministic = false } = {}) {
    if (!this.actor) return null;
    const actorRollData = this.actor.getRollData({ deterministic });
    const rollData = {
      ...actorRollData,
      item: this.toObject().system,
    };

    // Include an ability score modifier if one exists
    const abl = this.abilityMod;
    if (abl && "abilities" in rollData) {
      const ability = rollData.abilities[abl];
      if (!ability) {
        console.warn(
          `Item ${this.name} in Actor ${this.actor.name} has an invalid item ability modifier of ${abl} defined`
        );
      }
      rollData.mod = ability?.mod ?? 0;
    }
    return rollData;
  }

  /* -------------------------------------------- */
  /*  Chat Message Helpers                        */
  /* -------------------------------------------- */

  /**
   * Apply listeners to chat messages.
   * @param {HTML} html  Rendered chat message.
   */
  static chatListeners(html) {
    html.on("click", ".card-buttons button", this._onChatCardAction.bind(this));
    html.on("click", ".item-name", this._onChatCardToggleContent.bind(this));
  }

  /* -------------------------------------------- */

  /**
   * Handle execution of a chat card action via a click event on one of the card buttons
   * @param {Event} event       The originating click event
   * @returns {Promise}         A promise which resolves once the handler workflow is complete
   * @private
   */
  static async _onChatCardAction(event) {
    event.preventDefault();

    // Extract card data
    const button = event.currentTarget;
    button.disabled = true;
    const card = button.closest(".chat-card");
    const messageId = card.closest(".message").dataset.messageId;
    const message = game.messages.get(messageId);
    const action = button.dataset.action;

    // Recover the actor for the chat card
    const actor = await this._getChatCardActor(card);
    if (!actor) return;

    // Validate permission to proceed with the roll
    const isTargetted = action === "save";
    if (!(isTargetted || game.user.isGM || actor.isOwner)) return;

    // Get the Item from stored flag data or by the item ID on the Actor
    const storedData = message.getFlag("sds", "itemData");
    const item = storedData
      ? new this(storedData, { parent: actor })
      : actor.items.get(card.dataset.itemId);
    if (!item) {
      const err = game.i18n.format("SdS.ActionWarningNoItem", {
        item: card.dataset.itemId,
        name: actor.name,
      });
      return ui.notifications.error(err);
    }
    const spellLevel = parseInt(card.dataset.spellLevel) || null;

    // Handle different actions
    let targets;
    switch (action) {
      case "attack":
        await item.rollAttack({
          event: event,
          spellLevel: spellLevel,
        });
        break;
      case "damage":
      case "versatile":
        await item.rollDamage({
          event: event,
          spellLevel: spellLevel,
          versatile: action === "versatile",
        });
        break;
      case "formula":
        await item.rollFormula({ event, spellLevel });
        break;
      case "save":
        targets = this._getChatCardTargets(card);
        for (let token of targets) {
          const speaker = ChatMessage.getSpeaker({
            scene: canvas.scene,
            token: token.document,
          });
          await token.actor.rollAbilitySave(button.dataset.ability, {
            event,
            speaker,
          });
        }
        break;
      case "toolCheck":
        await item.rollToolCheck({ event });
        break;
      case "placeTemplate":
        try {
          await sds.canvas.AbilityTemplate.fromItem(item)?.drawPreview();
        } catch (err) {}
        break;
      case "abilityCheck":
        targets = this._getChatCardTargets(card);
        for (let token of targets) {
          const speaker = ChatMessage.getSpeaker({
            scene: canvas.scene,
            token: token.document,
          });
          await token.actor.rollAbilityTest(button.dataset.ability, {
            event,
            speaker,
          });
        }
        break;
    }

    // Re-enable the button
    button.disabled = false;
  }

  /* -------------------------------------------- */

  /**
   * Handle toggling the visibility of chat card content when the name is clicked
   * @param {Event} event   The originating click event
   * @private
   */
  static _onChatCardToggleContent(event) {
    event.preventDefault();
    const header = event.currentTarget;
    const card = header.closest(".chat-card");
    const content = card.querySelector(".card-content");
    content.style.display = content.style.display === "none" ? "block" : "none";
  }

  /* -------------------------------------------- */

  /**
   * Get the Actor which is the author of a chat card
   * @param {HTMLElement} card    The chat card being used
   * @returns {Actor|null}        The Actor document or null
   * @private
   */
  static async _getChatCardActor(card) {
    // Case 1 - a synthetic actor from a Token
    if (card.dataset.tokenId) {
      const token = await fromUuid(card.dataset.tokenId);
      if (!token) return null;
      return token.actor;
    }

    // Case 2 - use Actor ID directory
    const actorId = card.dataset.actorId;
    return game.actors.get(actorId) || null;
  }

  /* -------------------------------------------- */

  /**
   * Get the Actor which is the author of a chat card
   * @param {HTMLElement} card    The chat card being used
   * @returns {Actor[]}            An Array of Actor documents, if any
   * @private
   */
  static _getChatCardTargets(card) {
    let targets = canvas.tokens.controlled.filter((t) => !!t.actor);
    if (!targets.length && game.user.character)
      targets = targets.concat(game.user.character.getActiveTokens());
    if (!targets.length)
      ui.notifications.warn(game.i18n.localize("SdS.ActionWarningNoToken"));
    return targets;
  }

  /* -------------------------------------------- */
  /*  Advancements                                */
  /* -------------------------------------------- */

  /**
   * Create a new advancement of the specified type.
   * @param {string} type                          Type of advancement to create.
   * @param {object} [data]                        Data to use when creating the advancement.
   * @param {object} [options]
   * @param {boolean} [options.showConfig=true]    Should the new advancement's configuration application be shown?
   * @param {boolean} [options.source=false]       Should a source-only update be performed?
   * @returns {Promise<AdvancementConfig>|Item5e}  Promise for advancement config for new advancement if local
   *                                               is `false`, or item with newly added advancement.
   */
  createAdvancement(
    type,
    data = {},
    { showConfig = true, source = false } = {}
  ) {
    if (!this.system.advancement) return this;

    const Advancement = CONFIG.SdS.advancementTypes[type];
    if (!Advancement)
      throw new Error(`${type} not found in CONFIG.SdS.advancementTypes`);

    if (
      !Advancement.metadata.validItemTypes.has(this.type) ||
      !Advancement.availableForItem(this)
    ) {
      throw new Error(`${type} advancement cannot be added to ${this.name}`);
    }

    const advancement = new Advancement(data, { parent: this });
    const advancementCollection = this.toObject().system.advancement;
    advancementCollection.push(advancement.toObject());
    if (source)
      return this.updateSource({ "system.advancement": advancementCollection });
    return this.update({ "system.advancement": advancementCollection }).then(
      () => {
        if (!showConfig) return this;
        const config = new Advancement.metadata.apps.config(
          this.advancement.byId[advancement.id]
        );
        return config.render(true);
      }
    );
  }

  /* -------------------------------------------- */

  /**
   * Update an advancement belonging to this item.
   * @param {string} id                       ID of the advancement to update.
   * @param {object} updates                  Updates to apply to this advancement.
   * @param {object} [options={}]
   * @param {boolean} [options.source=false]  Should a source-only update be performed?
   * @returns {Promise<Item5e>|Item5e}        This item with the changes applied, promised if source is `false`.
   */
  updateAdvancement(id, updates, { source = false } = {}) {
    if (!this.system.advancement) return this;
    const idx = this.system.advancement.findIndex((a) => a._id === id);
    if (idx === -1)
      throw new Error(`Advancement of ID ${id} could not be found to update`);

    const advancement = this.advancement.byId[id];
    advancement.updateSource(updates);
    if (source) {
      advancement.render();
      return this;
    }

    const advancementCollection = this.toObject().system.advancement;
    advancementCollection[idx] = advancement.toObject();
    return this.update({ "system.advancement": advancementCollection }).then(
      (r) => {
        advancement.render();
        return r;
      }
    );
  }

  /* -------------------------------------------- */

  /**
   * Remove an advancement from this item.
   * @param {string} id                       ID of the advancement to remove.
   * @param {object} [options={}]
   * @param {boolean} [options.source=false]  Should a source-only update be performed?
   * @returns {Promise<Item5e>|Item5e}        This item with the changes applied.
   */
  deleteAdvancement(id, { source = false } = {}) {
    if (!this.system.advancement) return this;

    const advancementCollection = this.system.advancement.filter(
      (a) => a._id !== id
    );
    if (source)
      return this.updateSource({ "system.advancement": advancementCollection });
    return this.update({ "system.advancement": advancementCollection });
  }

  /* -------------------------------------------- */

  /**
   * Duplicate an advancement, resetting its value to default and giving it a new ID.
   * @param {string} id                             ID of the advancement to duplicate.
   * @param {object} [options]
   * @param {boolean} [options.showConfig=true]     Should the new advancement's configuration application be shown?
   * @param {boolean} [options.source=false]        Should a source-only update be performed?
   * @returns {Promise<AdvancementConfig>|Item5e}   Promise for advancement config for duplicate advancement if source
   *                                                is `false`, or item with newly duplicated advancement.
   */
  duplicateAdvancement(id, options) {
    const original = this.advancement.byId[id];
    if (!original) return this;
    const duplicate = original.toObject();
    delete duplicate._id;
    if (original.constructor.metadata.dataModels?.value) {
      duplicate.value =
        new original.constructor.metadata.dataModels.value().toObject();
    } else {
      duplicate.value = original.constructor.metadata.defaults?.value ?? {};
    }
    return this.createAdvancement(
      original.constructor.typeName,
      duplicate,
      options
    );
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  getEmbeddedDocument(embeddedName, id, options) {
    if (embeddedName !== "Advancement")
      return super.getEmbeddedDocument(embeddedName, id, options);
    const advancement = this.advancement.byId[id];
    if (options?.strict && advancement === undefined) {
      throw new Error(
        `The key ${id} does not exist in the ${embeddedName} Collection`
      );
    }
    return advancement;
  }

  /* -------------------------------------------- */
  /*  Event Handlers                              */
  /* -------------------------------------------- */

  /** @inheritdoc */
  async _preCreate(data, options, user) {
    await super._preCreate(data, options, user);

    // Create class identifier based on name
    if (["class", "subclass"].includes(this.type) && !this.system.identifier) {
      await this.updateSource({
        "system.identifier": data.name.slugify({ strict: true }),
      });
    }

    if (!this.isEmbedded || this.parent.type === "vehicle") return;
    const isNPC = this.parent.type === "npc";
    let updates;
    switch (data.type) {
      case "equipment":
        updates = this._onCreateOwnedEquipment(data, isNPC);
        break;
      case "spell":
        updates = this._onCreateOwnedSpell(data, isNPC);
        break;
      case "tool":
        updates = this._onCreateOwnedTool(data, isNPC);
        break;
      case "weapon":
        updates = this._onCreateOwnedWeapon(data, isNPC);
        break;
    }
    if (updates) return this.updateSource(updates);
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async _onCreate(data, options, userId) {
    super._onCreate(data, options, userId);
    if (userId !== game.user.id || !this.parent) return;

    // Assign a new original class
    if (this.parent.type === "character" && this.type === "class") {
      const pc = this.parent.items.get(
        this.parent.system.details.originalClass
      );
      if (!pc) await this.parent._assignPrimaryClass();
    }
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async _preUpdate(changed, options, user) {
    await super._preUpdate(changed, options, user);
    if (this.type !== "class" || !("levels" in (changed.system || {}))) return;

    // Check to make sure the updated class level isn't below zero
    if (changed.system.levels <= 0) {
      ui.notifications.warn(game.i18n.localize("SdS.MaxClassLevelMinimumWarn"));
      changed.system.levels = 1;
    }

    // Check to make sure the updated class level doesn't exceed level cap
    if (changed.system.levels > CONFIG.SdS.maxLevel) {
      ui.notifications.warn(
        game.i18n.format("SdS.MaxClassLevelExceededWarn", {
          max: CONFIG.SdS.maxLevel,
        })
      );
      changed.system.levels = CONFIG.SdS.maxLevel;
    }
    if (!this.isEmbedded || this.parent.type !== "character") return;

    // Check to ensure the updated character doesn't exceed level cap
    const newCharacterLevel =
      this.actor.system.details.level +
      (changed.system.levels - this.system.levels);
    if (newCharacterLevel > CONFIG.SdS.maxLevel) {
      ui.notifications.warn(
        game.i18n.format("SdS.MaxCharacterLevelExceededWarn", {
          max: CONFIG.SdS.maxLevel,
        })
      );
      changed.system.levels -= newCharacterLevel - CONFIG.SdS.maxLevel;
    }
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _onDelete(options, userId) {
    super._onDelete(options, userId);
    if (userId !== game.user.id || !this.parent) return;

    // Assign a new original class
    if (
      this.type === "class" &&
      this.id === this.parent.system.details.originalClass
    ) {
      this.parent._assignPrimaryClass();
    }
  }

  /* -------------------------------------------- */

  /**
   * Pre-creation logic for the automatic configuration of owned equipment type Items.
   *
   * @param {object} data       Data for the newly created item.
   * @param {boolean} isNPC     Is this actor an NPC?
   * @returns {object}          Updates to apply to the item data.
   * @private
   */
  _onCreateOwnedEquipment(data, isNPC) {
    const updates = {};
    if (foundry.utils.getProperty(data, "system.equipped") === undefined) {
      updates["system.equipped"] = isNPC; // NPCs automatically equip equipment
    }
    if (foundry.utils.getProperty(data, "system.proficient") === undefined) {
      if (isNPC) {
        updates["system.proficient"] = true; // NPCs automatically have equipment proficiency
      } else {
        const armorProf =
          CONFIG.SdS.armorProficienciesMap[this.system.armor?.type]; // Player characters check proficiency
        const actorArmorProfs =
          this.parent.system.traits?.armorProf?.value || new Set();
        updates["system.proficient"] =
          armorProf === true ||
          actorArmorProfs.has(armorProf) ||
          actorArmorProfs.has(this.system.baseItem);
      }
    }
    return updates;
  }

  /* -------------------------------------------- */

  /**
   * Pre-creation logic for the automatic configuration of owned spell type Items.
   *
   * @param {object} data       Data for the newly created item.
   * @param {boolean} isNPC     Is this actor an NPC?
   * @returns {object}          Updates to apply to the item data.
   * @private
   */
  _onCreateOwnedSpell(data, isNPC) {
    const updates = {};
    if (
      foundry.utils.getProperty(data, "system.preparation.prepared") ===
      undefined
    ) {
      updates["system.preparation.prepared"] = isNPC; // NPCs automatically prepare spells
    }
    return updates;
  }

  /* -------------------------------------------- */

  /**
   * Pre-creation logic for the automatic configuration of owned tool type Items.
   * @param {object} data       Data for the newly created item.
   * @param {boolean} isNPC     Is this actor an NPC?
   * @returns {object}          Updates to apply to the item data.
   * @private
   */
  _onCreateOwnedTool(data, isNPC) {
    const updates = {};
    if (data.system?.proficient === undefined) {
      if (isNPC) updates["system.proficient"] = 1;
      else {
        const actorToolProfs =
          this.parent.system.traits?.toolProf?.value || new Set();
        const proficient =
          actorToolProfs.has(this.system.toolType) ||
          actorToolProfs.has(this.system.baseItem);
        updates["system.proficient"] = Number(proficient);
      }
    }
    return updates;
  }

  /* -------------------------------------------- */

  /**
   * Pre-creation logic for the automatic configuration of owned weapon type Items.
   * @param {object} data       Data for the newly created item.
   * @param {boolean} isNPC     Is this actor an NPC?
   * @returns {object}          Updates to apply to the item data.
   * @private
   */
  _onCreateOwnedWeapon(data, isNPC) {
    // NPCs automatically equip items and are proficient with them
    if (isNPC) {
      const updates = {};
      if (!foundry.utils.hasProperty(data, "system.equipped"))
        updates["system.equipped"] = true;
      if (!foundry.utils.hasProperty(data, "system.proficient"))
        updates["system.proficient"] = true;
      return updates;
    }
    if (data.system?.proficient !== undefined) return {};

    // Some weapon types are always proficient
    const weaponProf =
      CONFIG.SdS.weaponProficienciesMap[this.system.weaponType];
    const updates = {};
    if (weaponProf === true) updates["system.proficient"] = true;
    // Characters may have proficiency in this weapon type (or specific base weapon)
    else {
      const actorProfs =
        this.parent.system.traits?.weaponProf?.value || new Set();
      updates["system.proficient"] =
        actorProfs.has(weaponProf) || actorProfs.has(this.system.baseItem);
    }
    return updates;
  }

  /* -------------------------------------------- */
  /*  Factory Methods                             */
  /* -------------------------------------------- */

  /**
   * Create a consumable spell scroll Item from a spell Item.
   * @param {Item5e} spell      The spell to be made into a scroll
   * @returns {Item5e}          The created scroll consumable item
   */
  static async createScrollFromSpell(spell) {
    // Get spell data
    const itemData = spell instanceof Item5e ? spell.toObject() : spell;
    let {
      actionType,
      description,
      source,
      activation,
      duration,
      target,
      range,
      damage,
      formula,
      save,
      level,
      attackBonus,
    } = itemData.system;

    // Get scroll data
    const scrollUuid = `Compendium.${CONFIG.SdS.sourcePacks.ITEMS}.${CONFIG.SdS.spellScrollIds[level]}`;
    const scrollItem = await fromUuid(scrollUuid);
    const scrollData = scrollItem.toObject();
    delete scrollData._id;

    // Split the scroll description into an intro paragraph and the remaining details
    const scrollDescription = scrollData.system.description.value;
    const pdel = "</p>";
    const scrollIntroEnd = scrollDescription.indexOf(pdel);
    const scrollIntro = scrollDescription.slice(
      0,
      scrollIntroEnd + pdel.length
    );
    const scrollDetails = scrollDescription.slice(scrollIntroEnd + pdel.length);

    // Create a composite description from the scroll description and the spell details
    const desc = `${scrollIntro}<hr/><h3>${itemData.name} (Level ${level})</h3><hr/>${description.value}<hr/><h3>Scroll Details</h3><hr/>${scrollDetails}`;

    // Used a fixed attack modifier and saving throw according to the level of spell scroll.
    if (["mwak", "rwak", "msak", "rsak"].includes(actionType)) {
      attackBonus = `${scrollData.system.attackBonus} - @mod`;
    }
    if (save.ability) {
      save.scaling = "flat";
      save.dc = scrollData.system.save.dc;
    }

    // Create the spell scroll data
    const spellScrollData = foundry.utils.mergeObject(scrollData, {
      name: `${game.i18n.localize("SdS.SpellScroll")}: ${itemData.name}`,
      img: itemData.img,
      system: {
        "description.value": desc.trim(),
        source,
        actionType,
        activation,
        duration,
        target,
        range,
        damage,
        formula,
        save,
        level,
        attackBonus,
      },
    });
    return new this(spellScrollData);
  }
}

/**
 * An abstract class containing common functionality between actor sheet configuration apps.
 * @extends {DocumentSheet}
 * @abstract
 */
class BaseConfigSheet extends DocumentSheet {
  /** @inheritdoc */
  activateListeners(html) {
    super.activateListeners(html);
    if (this.isEditable) {
      for (const override of this._getActorOverrides()) {
        html
          .find(`input[name="${override}"],select[name="${override}"]`)
          .each((i, el) => {
            el.disabled = true;
            el.dataset.tooltip = "SdS.ActiveEffectOverrideWarning";
          });
      }
    }
  }

  /* -------------------------------------------- */

  /**
   * Retrieve the list of fields that are currently modified by Active Effects on the Actor.
   * @returns {string[]}
   * @protected
   */
  _getActorOverrides() {
    return Object.keys(
      foundry.utils.flattenObject(this.object.overrides || {})
    );
  }
}

/**
 * A simple form to set save throw configuration for a given ability score.
 *
 * @param {Actor5e} actor               The Actor instance being displayed within the sheet.
 * @param {ApplicationOptions} options  Additional application configuration options.
 * @param {string} abilityId            The ability key as defined in CONFIG.SdS.abilities.
 */
class ActorAbilityConfig extends BaseConfigSheet {
  constructor(actor, options, abilityId) {
    super(actor, options);
    this._abilityId = abilityId;
  }

  /* -------------------------------------------- */

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["sds"],
      template: "systems/sds/templates/apps/ability-config.hbs",
      width: 500,
      height: "auto",
    });
  }

  /* -------------------------------------------- */

  /** @override */
  get title() {
    return `${game.i18n.format("SdS.AbilityConfigureTitle", {
      ability: CONFIG.SdS.abilities[this._abilityId],
    })}: ${this.document.name}`;
  }

  /* -------------------------------------------- */

  /** @override */
  getData(options) {
    const src = this.document.toObject();
    return {
      ability:
        src.system.abilities[this._abilityId] ??
        this.document.system.abilities[this._abilityId] ??
        {},
      labelSaves: game.i18n.format("SdS.AbilitySaveConfigure", {
        ability: CONFIG.SdS.abilities[this._abilityId],
      }),
      labelChecks: game.i18n.format("SdS.AbilityCheckConfigure", {
        ability: CONFIG.SdS.abilities[this._abilityId],
      }),
      abilityId: this._abilityId,
      proficiencyLevels: {
        0: CONFIG.SdS.proficiencyLevels[0],
        1: CONFIG.SdS.proficiencyLevels[1],
      },
      bonusGlobalSave: src.system.bonuses?.abilities?.save,
      bonusGlobalCheck: src.system.bonuses?.abilities?.check,
    };
  }
}

/**
 * Interface for managing a character's armor calculation.
 */
class ActorArmorConfig extends BaseConfigSheet {
  constructor(...args) {
    super(...args);

    /**
     * Cloned copy of the actor for previewing changes.
     * @type {Actor5e}
     */
    this.clone = this.document.clone();
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["sds", "actor-armor-config"],
      template: "systems/sds/templates/apps/actor-armor.hbs",
      width: 320,
      height: "auto",
      sheetConfig: false,
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  get title() {
    return `${game.i18n.localize("SdS.ArmorConfig")}: ${this.document.name}`;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async getData() {
    const ac = this.clone.system.attributes.ac;
    const isFlat = ["flat", "natural"].includes(ac.calc);

    // Get configuration data for the calculation mode, reset to flat if configuration is unavailable
    let cfg = CONFIG.SdS.armorClasses[ac.calc];
    if (!cfg) {
      ac.calc = "flat";
      cfg = CONFIG.SdS.armorClasses.flat;
      this.clone.updateSource({ "system.attributes.ac.calc": "flat" });
    }

    return {
      ac,
      isFlat,
      calculations: CONFIG.SdS.armorClasses,
      valueDisabled: !isFlat,
      formula: ac.calc === "custom" ? ac.formula : cfg.formula,
      formulaDisabled: ac.calc !== "custom",
    };
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _getActorOverrides() {
    return Object.keys(
      foundry.utils.flattenObject(
        this.object.overrides?.system?.attributes || {}
      )
    );
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async _updateObject(event, formData) {
    const ac = foundry.utils.expandObject(formData).ac;
    return this.document.update({ "system.attributes.ac": ac });
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */

  /** @inheritdoc */
  async _onChangeInput(event) {
    await super._onChangeInput(event);

    // Update clone with new data & re-render
    this.clone.updateSource({
      [`system.attributes.${event.currentTarget.name}`]:
        event.currentTarget.value,
    });
    this.render();
  }
}

/**
 * A simple form to set actor hit dice amounts.
 */
class ActorHitDiceConfig extends BaseConfigSheet {
  /** @inheritDoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["sds", "hd-config", "dialog"],
      template: "systems/sds/templates/apps/hit-dice-config.hbs",
      width: 360,
      height: "auto",
    });
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  get title() {
    return `${game.i18n.localize("SdS.HitDiceConfig")}: ${this.object.name}`;
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  getData(options) {
    return {
      classes: this.object.items
        .reduce((classes, item) => {
          if (item.type === "class") {
            classes.push({
              classItemId: item.id,
              name: item.name,
              diceDenom: item.system.hitDice,
              currentHitDice: item.system.levels - item.system.hitDiceUsed,
              maxHitDice: item.system.levels,
              canRoll: item.system.levels - item.system.hitDiceUsed > 0,
            });
          }
          return classes;
        }, [])
        .sort(
          (a, b) =>
            parseInt(b.diceDenom.slice(1)) - parseInt(a.diceDenom.slice(1))
        ),
    };
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  activateListeners(html) {
    super.activateListeners(html);

    // Hook up -/+ buttons to adjust the current value in the form
    html.find("button.increment,button.decrement").click((event) => {
      const button = event.currentTarget;
      const current = button.parentElement.querySelector(".current");
      const max = button.parentElement.querySelector(".max");
      const direction = button.classList.contains("increment") ? 1 : -1;
      current.value = Math.clamped(
        parseInt(current.value) + direction,
        0,
        parseInt(max.value)
      );
    });

    html.find("button.roll-hd").click(this._onRollHitDie.bind(this));
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _updateObject(event, formData) {
    const actorItems = this.object.items;
    const classUpdates = Object.entries(formData).map(([id, hd]) => ({
      _id: id,
      "system.hitDiceUsed": actorItems.get(id).system.levels - hd,
    }));
    return this.object.updateEmbeddedDocuments("Item", classUpdates);
  }

  /* -------------------------------------------- */

  /**
   * Rolls the hit die corresponding with the class row containing the event's target button.
   * @param {MouseEvent} event  Triggering click event.
   * @protected
   */
  async _onRollHitDie(event) {
    event.preventDefault();
    const button = event.currentTarget;
    await this.object.rollHitDie(button.dataset.hdDenom);

    // Re-render dialog to reflect changed hit dice quantities
    this.render();
  }
}

/**
 * A form for configuring actor hit points and bonuses.
 */
class ActorHitPointsConfig extends BaseConfigSheet {
  constructor(...args) {
    super(...args);

    /**
     * Cloned copy of the actor for previewing changes.
     * @type {Actor5e}
     */
    this.clone = this.object.clone();
  }

  /* -------------------------------------------- */

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["sds", "actor-hit-points-config"],
      template: "systems/sds/templates/apps/hit-points-config.hbs",
      width: 320,
      height: "auto",
      sheetConfig: false,
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  get title() {
    return `${game.i18n.localize("SdS.HitPointsConfig")}: ${
      this.document.name
    }`;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  getData(options) {
    return {
      hp: this.clone.system.attributes.hp,
      source: this.clone.toObject().system.attributes.hp,
      isCharacter: this.document.type === "character",
    };
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _getActorOverrides() {
    return Object.keys(
      foundry.utils.flattenObject(
        this.object.overrides?.system?.attributes || {}
      )
    );
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async _updateObject(event, formData) {
    const hp = foundry.utils.expandObject(formData).hp;
    this.clone.updateSource({ "system.attributes.hp": hp });
    const maxDelta =
      this.clone.system.attributes.hp.max -
      this.document.system.attributes.hp.max;
    hp.value = Math.max(this.document.system.attributes.hp.value + maxDelta, 0);
    return this.document.update({ "system.attributes.hp": hp });
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */

  /** @inheritDoc */
  activateListeners(html) {
    super.activateListeners(html);
    html.find(".roll-hit-points").click(this._onRollHPFormula.bind(this));
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async _onChangeInput(event) {
    await super._onChangeInput(event);
    const t = event.currentTarget;

    // Update clone with new data & re-render
    this.clone.updateSource({
      [`system.attributes.${t.name}`]: t.value || null,
    });
    if (t.name !== "hp.formula") this.render();
  }

  /* -------------------------------------------- */

  /**
   * Handle rolling NPC health values using the provided formula.
   * @param {Event} event  The original click event.
   * @protected
   */
  async _onRollHPFormula(event) {
    event.preventDefault();
    try {
      const roll = await this.clone.rollNPCHitPoints();
      this.clone.updateSource({ "system.attributes.hp.max": roll.total });
      this.render();
    } catch (error) {
      ui.notifications.error(game.i18n.localize("SdS.HPFormulaError"));
      throw error;
    }
  }
}

/**
 * A form for configuring actor mana points and bonuses.
 */
class ActorManaPointsConfig extends BaseConfigSheet {
  constructor(...args) {
    super(...args);

    /**
     * Cloned copy of the actor for previewing changes.
     * @type {Actor5e}
     */
    this.clone = this.object.clone();
  }

  /* -------------------------------------------- */

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["sds", "actor-mana-points-config"],
      template: "systems/sds/templates/apps/mana-points-config.hbs",
      width: 320,
      height: "auto",
      sheetConfig: false,
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  get title() {
    return `${game.i18n.localize("SdS.ManaPointsConfig")}: ${
      this.document.name
    }`;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  getData(options) {
    return {
      mana: this.clone.system.attributes.mana,
      source: this.clone.toObject().system.attributes.mana,
      isCharacter: this.document.type === "character",
    };
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _getActorOverrides() {
    return Object.keys(
      foundry.utils.flattenObject(
        this.object.overrides?.system?.attributes || {}
      )
    );
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async _updateObject(event, formData) {
    const mana = foundry.utils.expandObject(formData).mana;
    this.clone.updateSource({ "system.attributes.mana": mana });
    const maxDelta =
      this.clone.system.attributes.mana.max -
      this.document.system.attributes.mana.max;
    mana.value = Math.max(
      this.document.system.attributes.mana.value + maxDelta,
      0
    );
    return this.document.update({ "system.attributes.mana": mana });
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */

  /** @inheritDoc */
  activateListeners(html) {
    super.activateListeners(html);
    html.find(".roll-mana-points").click(this._onRollManaFormula.bind(this));
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async _onChangeInput(event) {
    await super._onChangeInput(event);
    const t = event.currentTarget;

    // Update clone with new data & re-render
    this.clone.updateSource({
      [`system.attributes.${t.name}`]: t.value || null,
    });
    if (t.name !== "mana.formula") this.render();
  }

  /* -------------------------------------------- */

  /**
   * Handle rolling NPC mana values using the provided formula.
   * @param {Event} event  The original click event.
   * @protected
   */
  async _onRollManaFormula(event) {
    event.preventDefault();
    try {
      const roll = await this.clone.rollNPCHitPoints();
      this.clone.updateSource({ "system.attributes.mana.max": roll.total });
      this.render();
    } catch (error) {
      ui.notifications.error(game.i18n.localize("SdS.HPFormulaError"));
      throw error;
    }
  }
}

/**
 * A simple sub-application of the ActorSheet which is used to configure properties related to initiative.
 */
class ActorInitiativeConfig extends BaseConfigSheet {
  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["sds"],
      template: "systems/sds/templates/apps/initiative-config.hbs",
      width: 360,
      height: "auto",
    });
  }

  /* -------------------------------------------- */

  /** @override */
  get title() {
    return `${game.i18n.localize("SdS.InitiativeConfig")}: ${
      this.document.name
    }`;
  }

  /* -------------------------------------------- */

  /** @override */
  getData(options = {}) {
    const source = this.document.toObject();
    const init = source.system.attributes.init || {};
    const flags = source.flags.sds || {};
    return {
      ability: init.ability,
      abilities: CONFIG.SdS.abilities,
      bonus: init.bonus,
      initiativeAlert: flags.initiativeAlert,
      initiativeAdv: flags.initiativeAdv,
    };
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  _getSubmitData(updateData = {}) {
    const formData = super._getSubmitData(updateData);
    formData.flags = { sds: {} };
    for (const flag of ["initiativeAlert", "initiativeAdv"]) {
      const k = `flags.sds.${flag}`;
      if (formData[k]) formData.flags.sds[flag] = true;
      else formData.flags.sds[`-=${flag}`] = null;
      delete formData[k];
    }
    return formData;
  }
}

/**
 * A simple form to set actor movement speeds.
 */
class ActorMovementConfig extends BaseConfigSheet {
  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["sds"],
      template: "systems/sds/templates/apps/movement-config.hbs",
      width: 300,
      height: "auto",
    });
  }

  /* -------------------------------------------- */

  /** @override */
  get title() {
    return `${game.i18n.localize("SdS.MovementConfig")}: ${this.document.name}`;
  }

  /* -------------------------------------------- */

  /** @override */
  getData(options = {}) {
    const source = this.document.toObject();

    // Current movement values
    const movement = source.system.attributes?.movement || {};
    for (let [k, v] of Object.entries(movement)) {
      if (["units", "hover"].includes(k)) continue;
      movement[k] = Number.isNumeric(v) ? v.toNearest(0.1) : 0;
    }

    // Allowed speeds
    const speeds =
      source.type === "group"
        ? {
            land: "SdS.MovementLand",
            water: "SdS.MovementWater",
            air: "SdS.MovementAir",
          }
        : {
            walk: "SdS.MovementWalk",
            burrow: "SdS.MovementBurrow",
            climb: "SdS.MovementClimb",
            fly: "SdS.MovementFly",
            swim: "SdS.MovementSwim",
          };

    // Return rendering context
    return {
      speeds,
      movement,
      selectUnits: source.type !== "group",
      canHover: source.type !== "group",
      units: CONFIG.SdS.movementUnits,
    };
  }
}

/**
 * A simple form to configure Actor senses.
 */
class ActorSensesConfig extends BaseConfigSheet {
  /** @inheritdoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["sds"],
      template: "systems/sds/templates/apps/senses-config.hbs",
      width: 300,
      height: "auto",
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  get title() {
    return `${game.i18n.localize("SdS.SensesConfig")}: ${this.document.name}`;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  getData(options) {
    const source = this.document.toObject().system.attributes?.senses || {};
    const data = {
      senses: {},
      special: source.special ?? "",
      units: source.units,
      movementUnits: CONFIG.SdS.movementUnits,
    };
    for (let [name, label] of Object.entries(CONFIG.SdS.senses)) {
      const v = Number(source[name]);
      data.senses[name] = {
        label: game.i18n.localize(label),
        value: Number.isNumeric(v) ? v.toNearest(0.1) : 0,
      };
    }
    return data;
  }
}

/**
 * An application class which provides advanced configuration for special character flags which modify an Actor.
 */
class ActorSheetFlags extends BaseConfigSheet {
  /** @inheritDoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "actor-flags",
      classes: ["sds"],
      template: "systems/sds/templates/apps/actor-flags.hbs",
      width: 500,
      closeOnSubmit: true,
    });
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  get title() {
    return `${game.i18n.localize("SdS.FlagsTitle")}: ${this.object.name}`;
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  getData() {
    const data = {};
    data.actor = this.object;
    data.classes = this._getClasses();
    data.flags = this._getFlags();
    data.bonuses = this._getBonuses();
    return data;
  }

  /* -------------------------------------------- */

  /**
   * Prepare an object of sorted classes.
   * @returns {object}
   * @private
   */
  _getClasses() {
    const classes = this.object.items.filter((i) => i.type === "class");
    return classes
      .sort((a, b) => a.name.localeCompare(b.name))
      .reduce((obj, i) => {
        obj[i.id] = i.name;
        return obj;
      }, {});
  }

  /* -------------------------------------------- */

  /**
   * Prepare an object of flags data which groups flags by section
   * Add some additional data for rendering
   * @returns {object}
   * @private
   */
  _getFlags() {
    const flags = {};
    const baseData = this.document.toJSON();
    for (let [k, v] of Object.entries(CONFIG.SdS.characterFlags)) {
      if (!flags.hasOwnProperty(v.section)) flags[v.section] = {};
      let flag = foundry.utils.deepClone(v);
      flag.type = v.type.name;
      flag.isCheckbox = v.type === Boolean;
      flag.isSelect = v.hasOwnProperty("choices");
      flag.value = foundry.utils.getProperty(baseData.flags, `sds.${k}`);
      flags[v.section][`flags.sds.${k}`] = flag;
    }
    return flags;
  }

  /* -------------------------------------------- */

  /**
   * Get the bonuses fields and their localization strings
   * @returns {Array<object>}
   * @private
   */
  _getBonuses() {
    const src = this.object.toObject();
    const bonuses = [
      { name: "system.bonuses.mwak.attack", label: "SdS.BonusMWAttack" },
      { name: "system.bonuses.mwak.damage", label: "SdS.BonusMWDamage" },
      { name: "system.bonuses.rwak.attack", label: "SdS.BonusRWAttack" },
      { name: "system.bonuses.rwak.damage", label: "SdS.BonusRWDamage" },
      { name: "system.bonuses.msak.attack", label: "SdS.BonusMSAttack" },
      { name: "system.bonuses.msak.damage", label: "SdS.BonusMSDamage" },
      { name: "system.bonuses.rsak.attack", label: "SdS.BonusRSAttack" },
      { name: "system.bonuses.rsak.damage", label: "SdS.BonusRSDamage" },
      {
        name: "system.bonuses.abilities.check",
        label: "SdS.BonusAbilityCheck",
      },
      {
        name: "system.bonuses.abilities.save",
        label: "SdS.BonusAbilitySave",
      },
      {
        name: "system.bonuses.abilities.skill",
        label: "SdS.BonusAbilitySkill",
      },
      { name: "system.bonuses.spell.dc", label: "SdS.BonusSpellDC" },
    ];
    for (let b of bonuses) {
      b.value = foundry.utils.getProperty(src, b.name) || "";
    }
    return bonuses;
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _updateObject(event, formData) {
    const actor = this.object;
    let updateData = foundry.utils.expandObject(formData);
    const src = actor.toObject();

    // Unset any flags which are "false"
    const flags = updateData.flags.sds;
    for (let [k, v] of Object.entries(flags)) {
      if ([undefined, null, "", false, 0].includes(v)) {
        delete flags[k];
        if (foundry.utils.hasProperty(src.flags, `sds.${k}`))
          flags[`-=${k}`] = null;
      }
    }

    // Clear any bonuses which are whitespace only
    for (let b of Object.values(updateData.system.bonuses)) {
      for (let [k, v] of Object.entries(b)) {
        b[k] = v.trim();
      }
    }

    // Diff the data against any applied overrides and apply
    await actor.update(updateData, { diff: false });
  }
}

/**
 * A simple form to set skill configuration for a given skill.
 *
 * @param {Actor} actor                 The Actor instance being displayed within the sheet.
 * @param {ApplicationOptions} options  Additional application configuration options.
 * @param {string} skillId              The skill key as defined in CONFIG.SdS.skills.
 */
class ActorSkillConfig extends BaseConfigSheet {
  constructor(actor, options, skillId) {
    super(actor, options);
    this._skillId = skillId;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["sds"],
      template: "systems/sds/templates/apps/skill-config.hbs",
      width: 500,
      height: "auto",
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  get title() {
    const label = CONFIG.SdS.skills[this._skillId].label;
    return `${game.i18n.format("SdS.SkillConfigureTitle", {
      skill: label,
    })}: ${this.document.name}`;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  getData(options) {
    const src = this.document.toObject();
    return {
      abilities: CONFIG.SdS.abilities,
      skill:
        src.system.skills?.[this._skillId] ??
        this.document.system.skills[this._skillId] ??
        {},
      skillId: this._skillId,
      proficiencyLevels: CONFIG.SdS.proficiencyLevels,
      bonusGlobal: src.system.bonuses?.abilities.skill,
    };
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _updateObject(event, formData) {
    const passive = formData[`system.skills.${this._skillId}.bonuses.passive`];
    const passiveRoll = new Roll(passive);
    if (!passiveRoll.isDeterministic) {
      const message = game.i18n.format("SdS.FormulaCannotContainDiceError", {
        name: game.i18n.localize("SdS.SkillBonusPassive"),
      });
      ui.notifications.error(message);
      throw new Error(message);
    }
    super._updateObject(event, formData);
  }
}

/**
 * A helper Dialog subclass for rolling Hit Dice on short rest.
 *
 * @param {Actor5e} actor           Actor that is taking the short rest.
 * @param {object} [dialogData={}]  An object of dialog data which configures how the modal window is rendered.
 * @param {object} [options={}]     Dialog rendering options.
 */
class ShortRestDialog extends Dialog {
  constructor(actor, dialogData = {}, options = {}) {
    super(dialogData, options);

    /**
     * Store a reference to the Actor document which is resting
     * @type {Actor}
     */
    this.actor = actor;

    /**
     * Track the most recently used HD denomination for re-rendering the form
     * @type {string}
     */
    this._denom = null;
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      template: "systems/sds/templates/apps/short-rest.hbs",
      classes: ["sds", "dialog"],
    });
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  getData() {
    const data = super.getData();

    // Determine Hit Dice
    data.availableHD = this.actor.items.reduce((hd, item) => {
      if (item.type === "class") {
        const { levels, hitDice, hitDiceUsed } = item.system;
        const denom = hitDice ?? "d6";
        const available = parseInt(levels ?? 1) - parseInt(hitDiceUsed ?? 0);
        hd[denom] = denom in hd ? hd[denom] + available : available;
      }
      return hd;
    }, {});
    data.canRoll = this.actor.system.attributes.hd > 0;
    data.denomination = this._denom;

    // Determine rest type
    const variant = game.settings.get("sds", "restVariant");
    data.promptNewDay = variant !== "epic"; // It's never a new day when only resting 1 minute
    data.newDay = false; // It may be a new day, but not by default
    return data;
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  activateListeners(html) {
    super.activateListeners(html);
    let btn = html.find("#roll-hd");
    btn.click(this._onRollHitDie.bind(this));
  }

  /* -------------------------------------------- */

  /**
   * Handle rolling a Hit Die as part of a Short Rest action
   * @param {Event} event     The triggering click event
   * @protected
   */
  async _onRollHitDie(event) {
    event.preventDefault();
    const btn = event.currentTarget;
    this._denom = btn.form.hd.value;
    await this.actor.rollHitDie(this._denom);
    this.render();
  }

  /* -------------------------------------------- */

  /**
   * A helper constructor function which displays the Short Rest dialog and returns a Promise once it's workflow has
   * been resolved.
   * @param {object} [options={}]
   * @param {Actor5e} [options.actor]  Actor that is taking the short rest.
   * @returns {Promise}                Promise that resolves when the rest is completed or rejects when canceled.
   */
  static async shortRestDialog({ actor } = {}) {
    return new Promise((resolve, reject) => {
      const dlg = new this(actor, {
        title: `${game.i18n.localize("SdS.ShortRest")}: ${actor.name}`,
        buttons: {
          rest: {
            icon: '<i class="fas fa-bed"></i>',
            label: game.i18n.localize("SdS.Rest"),
            callback: (html) => {
              let newDay = false;
              if (game.settings.get("sds", "restVariant") !== "epic") {
                newDay = html.find('input[name="newDay"]')[0].checked;
              }
              resolve(newDay);
            },
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize("Cancel"),
            callback: reject,
          },
        },
        close: reject,
      });
      dlg.render(true);
    });
  }
}

/**
 * A helper Dialog subclass for completing a long rest.
 *
 * @param {Actor5e} actor           Actor that is taking the long rest.
 * @param {object} [dialogData={}]  An object of dialog data which configures how the modal window is rendered.
 * @param {object} [options={}]     Dialog rendering options.
 */
class LongRestDialog extends Dialog {
  constructor(actor, dialogData = {}, options = {}) {
    super(dialogData, options);
    this.actor = actor;
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      template: "systems/sds/templates/apps/long-rest.hbs",
      classes: ["sds", "dialog"],
    });
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  getData() {
    const data = super.getData();
    const variant = game.settings.get("sds", "restVariant");
    data.promptNewDay = variant !== "gritty"; // It's always a new day when resting 1 week
    data.newDay = variant === "normal"; // It's probably a new day when resting normally (8 hours)
    return data;
  }

  /* -------------------------------------------- */

  /**
   * A helper constructor function which displays the Long Rest confirmation dialog and returns a Promise once it's
   * workflow has been resolved.
   * @param {object} [options={}]
   * @param {Actor5e} [options.actor]  Actor that is taking the long rest.
   * @returns {Promise}                Promise that resolves when the rest is completed or rejects when canceled.
   */
  static async longRestDialog({ actor } = {}) {
    return new Promise((resolve, reject) => {
      const dlg = new this(actor, {
        title: `${game.i18n.localize("SdS.LongRest")}: ${actor.name}`,
        buttons: {
          rest: {
            icon: '<i class="fas fa-bed"></i>',
            label: game.i18n.localize("SdS.Rest"),
            callback: (html) => {
              let newDay = true;
              if (game.settings.get("sds", "restVariant") !== "gritty") {
                newDay = html.find('input[name="newDay"]')[0].checked;
              }
              resolve(newDay);
            },
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize("Cancel"),
            callback: reject,
          },
        },
        default: "rest",
        close: reject,
      });
      dlg.render(true);
    });
  }
}

/**
 * Extend the base Actor class to implement additional system-specific logic.
 */
class Actor5e extends Actor {
  /**
   * The data source for Actor5e.classes allowing it to be lazily computed.
   * @type {Object<Item5e>}
   * @private
   */
  _classes;

  /* -------------------------------------------- */
  /*  Properties                                  */
  /* -------------------------------------------- */

  /**
   * A mapping of classes belonging to this Actor.
   * @type {Object<Item5e>}
   */
  get classes() {
    if (this._classes !== undefined) return this._classes;
    if (!["character", "npc"].includes(this.type)) return (this._classes = {});
    return (this._classes = this.items
      .filter((item) => item.type === "class")
      .reduce((obj, cls) => {
        obj[cls.identifier] = cls;
        return obj;
      }, {}));
  }

  /* -------------------------------------------- */

  /**
   * Is this Actor currently polymorphed into some other creature?
   * @type {boolean}
   */
  get isPolymorphed() {
    return this.getFlag("sds", "isPolymorphed") || false;
  }

  /* -------------------------------------------- */

  /**
   * The Actor's currently equipped armor, if any.
   * @type {Item5e|null}
   */
  get armor() {
    return this.system.attributes.ac.equippedArmor ?? null;
  }

  /* -------------------------------------------- */

  /**
   * The Actor's currently equipped shield, if any.
   * @type {Item5e|null}
   */
  get shield() {
    return this.system.attributes.ac.equippedShield ?? null;
  }

  /* -------------------------------------------- */
  /*  Methods                                     */
  /* -------------------------------------------- */

  /** @inheritdoc */
  _initializeSource(source, options = {}) {
    source = super._initializeSource(source, options);
    if (!source._id || !options.pack || sds.moduleArt.suppressArt)
      return source;
    const uuid = `Compendium.${options.pack}.${source._id}`;
    const art = game.sds.moduleArt.map.get(uuid);
    if (art?.actor || art?.token) {
      if (art.actor) source.img = art.actor;
      if (typeof art.token === "string")
        source.prototypeToken.texture.src = art.token;
      else if (art.token)
        foundry.utils.mergeObject(source.prototypeToken, art.token);
      const biography = source.system.details?.biography;
      if (art.credit && biography) {
        if (typeof biography.value !== "string") biography.value = "";
        biography.value += `<p>${art.credit}</p>`;
      }
    }
    return source;
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  prepareData() {
    this._classes = undefined;
    this._preparationWarnings = [];
    super.prepareData();
    this.items.forEach((item) => item.prepareFinalAttributes());
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  prepareBaseData() {
    // Delegate preparation to type-subclass
    if (this.type === "group") {
      // Eventually other types will also support this
      return this.system._prepareBaseData();
    }

    this._prepareBaseAbilities();
    this._prepareBaseSkills();
    this._prepareBaseArmorClass();

    // Type-specific preparation
    switch (this.type) {
      case "character":
        return this._prepareCharacterData();
      case "npc":
        return this._prepareNPCData();
      case "vehicle":
        return this._prepareVehicleData();
    }
  }

  /* --------------------------------------------- */

  /** @inheritDoc */
  applyActiveEffects() {
    this._prepareScaleValues();
    // The Active Effects do not have access to their parent at preparation time, so we wait until this stage to
    // determine whether they are suppressed or not.
    this.effects.forEach((e) => e.determineSuppression());
    return super.applyActiveEffects();
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  prepareDerivedData() {
    // Delegate preparation to type-subclass
    if (this.type === "group") {
      // Eventually other types will also support this
      return this.system._prepareDerivedData();
    }

    const flags = this.flags.sds || {};
    this.labels = {};

    // Retrieve data for polymorphed actors
    let originalSaves = null;
    let originalSkills = null;
    if (this.isPolymorphed) {
      const transformOptions = flags.transformOptions;
      const original = game.actors?.get(flags.originalActor);
      if (original) {
        if (transformOptions.mergeSaves)
          originalSaves = original.system.abilities;
        if (transformOptions.mergeSkills)
          originalSkills = original.system.skills;
      }
    }

    // Prepare abilities, skills, & everything else
    const globalBonuses = this.system.bonuses?.abilities ?? {};
    const rollData = this.getRollData();
    const checkBonus = simplifyBonus(globalBonuses?.check, rollData);
    this._prepareAbilities(rollData, globalBonuses, checkBonus, originalSaves);
    this._prepareSkills(rollData, globalBonuses, checkBonus, originalSkills);
    this._prepareArmorClass();
    this._prepareEncumbrance();
    this._prepareHitPoints(rollData);
    this._prepareInitiative(rollData, checkBonus);
    this._prepareSpellcasting();
  }

  /* -------------------------------------------- */

  /**
   * Return the amount of experience required to gain a certain character level.
   * @param {number} level  The desired level.
   * @returns {number}      The XP required.
   */
  getLevelExp(level) {
    const levels = CONFIG.SdS.CHARACTER_EXP_LEVELS;
    return levels[Math.min(level, levels.length - 1)];
  }

  /* -------------------------------------------- */

  /**
   * Return the amount of experience granted by killing a creature of a certain CR.
   * @param {number} cr     The creature's challenge rating.
   * @returns {number}      The amount of experience granted per kill.
   */
  getCRExp(cr) {
    if (cr < 1.0) return Math.max(200 * cr, 10);
    return CONFIG.SdS.CR_EXP_LEVELS[cr];
  }

  /* -------------------------------------------- */

  /**
   * @inheritdoc
   * @param {object} [options]
   * @param {boolean} [options.deterministic] Whether to force deterministic values for data properties that could be
   *                                            either a die term or a flat term.
   */
  getRollData({ deterministic = false } = {}) {
    const data = { ...super.getRollData() };
    if (this.type === "group") return data;
    data.prof = new Proficiency(this.system.attributes.prof, 1);
    if (deterministic) data.prof = data.prof.flat;
    data.attributes = foundry.utils.deepClone(data.attributes);
    data.attributes.spellmod =
      data.abilities[data.attributes.spellcasting || "int"]?.mod ?? 0;
    data.classes = {};
    for (const [identifier, cls] of Object.entries(this.classes)) {
      data.classes[identifier] = { ...cls.system };
      if (cls.subclass) data.classes[identifier].subclass = cls.subclass.system;
    }
    return data;
  }

  /* -------------------------------------------- */
  /*  Base Data Preparation Helpers               */
  /* -------------------------------------------- */

  /**
   * Update the actor's abilities list to match the abilities configured in `SdS.abilities`.
   * Mutates the system.abilities object.
   * @protected
   */
  _prepareBaseAbilities() {
    if (!("abilities" in this.system)) return;
    const abilities = {};
    for (const key of Object.keys(CONFIG.SdS.abilities)) {
      abilities[key] = this.system.abilities[key];
      if (!abilities[key]) {
        abilities[key] = foundry.utils.deepClone(
          game.system.template.Actor.templates.common.abilities.cha
        );

        // Honor: Charisma for NPC, 0 for vehicles
        if (key === "hon") {
          if (this.type === "vehicle") abilities[key].value = 0;
          else if (this.type === "npc")
            abilities[key].value = this.system.abilities.cha?.value ?? 10;
        }

        // Sanity: Wisdom for NPC, 0 for vehicles
        else if (key === "san") {
          if (this.type === "vehicle") abilities[key].value = 0;
          else if (this.type === "npc")
            abilities[key].value = this.system.abilities.wis?.value ?? 10;
        }
      }
    }
    this.system.abilities = abilities;
  }

  /* -------------------------------------------- */

  /**
   * Update the actor's skill list to match the skills configured in `SdS.skills`.
   * Mutates the system.skills object.
   * @protected
   */
  _prepareBaseSkills() {
    if (!("skills" in this.system)) return;
    const skills = {};
    for (const [key, skill] of Object.entries(CONFIG.SdS.skills)) {
      skills[key] = this.system.skills[key];
      if (!skills[key]) {
        skills[key] = foundry.utils.deepClone(
          game.system.template.Actor.templates.creature.skills.acr
        );
        skills[key].ability = skill.ability;
      }
    }
    this.system.skills = skills;
  }

  /* -------------------------------------------- */

  /**
   * Initialize derived AC fields for Active Effects to target.
   * Mutates the system.attributes.ac object.
   * @protected
   */
  _prepareBaseArmorClass() {
    const ac = this.system.attributes.ac;
    ac.armor = 10;
    ac.shield = ac.bonus = ac.cover = 0;
  }

  /* -------------------------------------------- */

  /**
   * Derive any values that have been scaled by the Advancement system.
   * Mutates the value of the `system.scale` object.
   * @protected
   */
  _prepareScaleValues() {
    this.system.scale = Object.entries(this.classes).reduce(
      (scale, [identifier, cls]) => {
        scale[identifier] = cls.scaleValues;
        if (cls.subclass)
          scale[cls.subclass.identifier] = cls.subclass.scaleValues;
        return scale;
      },
      {}
    );
  }

  /* -------------------------------------------- */

  /**
   * Perform any Character specific preparation.
   * Mutates several aspects of the system data object.
   * @protected
   */
  _prepareCharacterData() {
    this.system.details.level = 0;
    this.system.attributes.hd = 0;
    this.system.attributes.attunement.value = 0;

    for (const item of this.items) {
      // Class levels & hit dice
      if (item.type === "class") {
        const classLevels = parseInt(item.system.levels) || 1;
        this.system.details.level += classLevels;
        this.system.attributes.hd +=
          classLevels - (parseInt(item.system.hitDiceUsed) || 0);
      }

      // Attuned items
      else if (item.system.attunement === CONFIG.SdS.attunementTypes.ATTUNED) {
        this.system.attributes.attunement.value += 1;
      }
    }

    // Character proficiency bonus
    this.system.attributes.prof = Proficiency.calculateMod(
      this.system.details.level
    );

    // Experience required for next level
    const xp = this.system.details.xp;
    xp.max = this.getLevelExp(this.system.details.level || 1);
    const prior = this.getLevelExp(this.system.details.level - 1 || 0);
    const required = xp.max - prior;
    const pct = Math.round(((xp.value - prior) * 100) / required);
    xp.pct = Math.clamped(pct, 0, 100);
  }

  /* -------------------------------------------- */

  /**
   * Perform any NPC specific preparation.
   * Mutates several aspects of the system data object.
   * @protected
   */
  _prepareNPCData() {
    const cr = this.system.details.cr;

    // Attuned items
    this.system.attributes.attunement.value = this.items.filter((i) => {
      return i.system.attunement === CONFIG.SdS.attunementTypes.ATTUNED;
    }).length;

    // Kill Experience
    this.system.details.xp ??= {};
    this.system.details.xp.value = this.getCRExp(cr);

    // Proficiency
    this.system.attributes.prof = Proficiency.calculateMod(Math.max(cr, 1));

    // Spellcaster Level
    if (
      this.system.attributes.spellcasting &&
      !Number.isNumeric(this.system.details.spellLevel)
    ) {
      this.system.details.spellLevel = Math.max(cr, 1);
    }
  }

  /* -------------------------------------------- */

  /**
   * Perform any Vehicle specific preparation.
   * Mutates several aspects of the system data object.
   * @protected
   */
  _prepareVehicleData() {
    this.system.attributes.prof = 0;
  }

  /* -------------------------------------------- */
  /*  Derived Data Preparation Helpers            */
  /* -------------------------------------------- */

  /**
   * Prepare abilities.
   * @param {object} bonusData      Data produced by `getRollData` to be applied to bonus formulas.
   * @param {object} globalBonuses  Global bonus data.
   * @param {number} checkBonus     Global ability check bonus.
   * @param {object} originalSaves  A transformed actor's original actor's abilities.
   * @protected
   */
  _prepareAbilities(bonusData, globalBonuses, checkBonus, originalSaves) {
    const flags = this.flags.sds ?? {};
    const dcBonus = simplifyBonus(this.system.bonuses?.spell?.dc, bonusData);
    const saveBonus = simplifyBonus(globalBonuses.save, bonusData);
    for (const [id, abl] of Object.entries(this.system.abilities)) {
      if (flags.diamondSoul) abl.proficient = 1; // Diamond Soul is proficient in all saves
      abl.mod = Math.floor((abl.value - 10) / 2);

      const isRA = this._isRemarkableAthlete(id);
      abl.checkProf = new Proficiency(
        this.system.attributes.prof,
        isRA || flags.jackOfAllTrades ? 0.5 : 0,
        !isRA
      );
      const saveBonusAbl = simplifyBonus(abl.bonuses?.save, bonusData);
      abl.saveBonus = saveBonusAbl + saveBonus;

      abl.saveProf = new Proficiency(
        this.system.attributes.prof,
        abl.proficient
      );
      const checkBonusAbl = simplifyBonus(abl.bonuses?.check, bonusData);
      abl.checkBonus = checkBonusAbl + checkBonus;

      abl.save = abl.mod + abl.saveBonus;
      if (Number.isNumeric(abl.saveProf.term)) abl.save += abl.saveProf.flat;
      abl.dc = 8 + abl.mod + this.system.attributes.prof + dcBonus;

      // If we merged saves when transforming, take the highest bonus here.
      if (originalSaves && abl.proficient)
        abl.save = Math.max(abl.save, originalSaves[id].save);
    }
  }

  /* -------------------------------------------- */

  /**
   * Prepare skill checks. Mutates the values of system.skills.
   * @param {object} bonusData       Data produced by `getRollData` to be applied to bonus formulas.
   * @param {object} globalBonuses   Global bonus data.
   * @param {number} checkBonus      Global ability check bonus.
   * @param {object} originalSkills  A transformed actor's original actor's skills.
   * @protected
   */
  _prepareSkills(bonusData, globalBonuses, checkBonus, originalSkills) {
    if (this.type === "vehicle") return;
    const flags = this.flags.sds ?? {};

    // Skill modifiers
    const feats = CONFIG.SdS.characterFlags;
    const skillBonus = simplifyBonus(globalBonuses.skill, bonusData);
    for (const [id, skl] of Object.entries(this.system.skills)) {
      const ability = this.system.abilities[skl.ability];
      skl.value = Math.clamped(Number(skl.value).toNearest(0.5), 0, 2) ?? 0;
      const baseBonus = simplifyBonus(skl.bonuses?.check, bonusData);
      let roundDown = true;

      // Remarkable Athlete
      if (this._isRemarkableAthlete(skl.ability) && skl.value < 0.5) {
        skl.value = 0.5;
        roundDown = false;
      }

      // Jack of All Trades
      else if (flags.jackOfAllTrades && skl.value < 0.5) {
        skl.value = 0.5;
      }

      // Polymorph Skill Proficiencies
      if (originalSkills) {
        skl.value = Math.max(skl.value, originalSkills[id].value);
      }

      // Compute modifier
      const checkBonusAbl = simplifyBonus(ability?.bonuses?.check, bonusData);
      skl.bonus = baseBonus + checkBonus + checkBonusAbl + skillBonus;
      skl.mod = ability?.mod ?? 0;
      skl.prof = new Proficiency(
        this.system.attributes.prof,
        skl.value,
        roundDown
      );
      skl.proficient = skl.value;
      skl.total = skl.mod + skl.bonus;
      if (Number.isNumeric(skl.prof.term)) skl.total += skl.prof.flat;

      // Compute passive bonus
      const passive =
        flags.observantFeat && feats.observantFeat.skills.includes(id) ? 5 : 0;
      const passiveBonus = simplifyBonus(skl.bonuses?.passive, bonusData);
      skl.passive =
        10 + skl.mod + skl.bonus + skl.prof.flat + passive + passiveBonus;
    }
  }

  /* -------------------------------------------- */

  /**
   * Prepare a character's AC value from their equipped armor and shield.
   * Mutates the value of the `system.attributes.ac` object.
   */
  _prepareArmorClass() {
    const ac = this.system.attributes.ac;

    // Apply automatic migrations for older data structures
    let cfg = CONFIG.SdS.armorClasses[ac.calc];
    if (!cfg) {
      ac.calc = "flat";
      if (Number.isNumeric(ac.value)) ac.flat = Number(ac.value);
      cfg = CONFIG.SdS.armorClasses.flat;
    }

    // Identify Equipped Items
    const armorTypes = new Set(Object.keys(CONFIG.SdS.armorTypes));
    const { armors, shields } = this.itemTypes.equipment.reduce(
      (obj, equip) => {
        const armor = equip.system.armor;
        if (!equip.system.equipped || !armorTypes.has(armor?.type)) return obj;
        if (armor.type === "shield") obj.shields.push(equip);
        else obj.armors.push(equip);
        return obj;
      },
      { armors: [], shields: [] }
    );

    // Determine base AC
    switch (ac.calc) {
      // Flat AC (no additional bonuses)
      case "flat":
        ac.value = Number(ac.flat);
        return;

      // Natural AC (includes bonuses)
      case "natural":
        ac.base = Number(ac.flat);
        break;

      default:
        let formula = ac.calc === "custom" ? ac.formula : cfg.formula;
        if (armors.length) {
          if (armors.length > 1)
            this._preparationWarnings.push({
              message: game.i18n.localize("SdS.WarnMultipleArmor"),
              type: "warning",
            });
          const armorData = armors[0].system.armor;
          const isHeavy = armorData.type === "heavy";
          ac.armor = armorData.value ?? ac.armor;
          ac.dex = isHeavy
            ? 0
            : Math.min(
                armorData.dex ?? Infinity,
                this.system.abilities.dex?.mod ?? 0
              );
          ac.equippedArmor = armors[0];
        } else ac.dex = this.system.abilities.dex?.mod ?? 0;

        const rollData = this.getRollData({ deterministic: true });
        rollData.attributes.ac = ac;
        try {
          const replaced = Roll.replaceFormulaData(formula, rollData);
          ac.base = Roll.safeEval(replaced);
        } catch (err) {
          this._preparationWarnings.push({
            message: game.i18n.localize("SdS.WarnBadACFormula"),
            link: "armor",
            type: "error",
          });
          const replaced = Roll.replaceFormulaData(
            CONFIG.SdS.armorClasses.default.formula,
            rollData
          );
          ac.base = Roll.safeEval(replaced);
        }
        break;
    }

    // Equipped Shield
    if (shields.length) {
      if (shields.length > 1)
        this._preparationWarnings.push({
          message: game.i18n.localize("SdS.WarnMultipleShields"),
          type: "warning",
        });
      ac.shield = shields[0].system.armor.value ?? 0;
      ac.equippedShield = shields[0];
    }

    // Compute total AC and return
    ac.value = ac.base + ac.shield + ac.bonus + ac.cover;
  }

  /* -------------------------------------------- */

  /**
   * Prepare the level and percentage of encumbrance for an Actor.
   * Optionally include the weight of carried currency by applying the standard rule from the PHB pg. 143.
   * Mutates the value of the `system.attributes.encumbrance` object.
   * @protected
   */
  _prepareEncumbrance() {
    const encumbrance = (this.system.attributes.encumbrance ??= {});

    // Get the total weight from items
    const physicalItems = [
      "weapon",
      "equipment",
      "consumable",
      "tool",
      "backpack",
      "loot",
    ];
    let weight = this.items.reduce((weight, i) => {
      if (!physicalItems.includes(i.type)) return weight;
      const q = i.system.quantity || 0;
      const w = i.system.weight || 0;
      return weight + q * w;
    }, 0);

    // [Optional] add Currency Weight (for non-transformed actors)
    const currency = this.system.currency;
    if (game.settings.get("sds", "currencyWeight") && currency) {
      const numCoins = Object.values(currency).reduce(
        (val, denom) => val + Math.max(denom, 0),
        0
      );
      const currencyPerWeight = game.settings.get("sds", "metricWeightUnits")
        ? CONFIG.SdS.encumbrance.currencyPerWeight.metric
        : CONFIG.SdS.encumbrance.currencyPerWeight.imperial;
      weight += numCoins / currencyPerWeight;
    }

    // Determine the Encumbrance size class
    let mod =
      { tiny: 0.5, sm: 1, med: 1, lg: 2, huge: 4, grg: 8 }[
        this.system.traits.size
      ] || 1;
    if (this.flags.sds?.powerfulBuild) mod = Math.min(mod * 2, 8);

    const strengthMultiplier = game.settings.get("sds", "metricWeightUnits")
      ? CONFIG.SdS.encumbrance.strMultiplier.metric
      : CONFIG.SdS.encumbrance.strMultiplier.imperial;

    // Populate final Encumbrance values
    encumbrance.value = weight.toNearest(0.1);
    encumbrance.max = (
      (this.system.abilities.str?.value ?? 10) *
      strengthMultiplier *
      mod
    ).toNearest(0.1);
    encumbrance.pct = Math.clamped(
      (encumbrance.value * 100) / encumbrance.max,
      0,
      100
    );
    encumbrance.encumbered = encumbrance.pct > 200 / 3;
  }

  /* -------------------------------------------- */

  /**
   * Prepare hit points for characters.
   * @param {object} rollData  Data produced by `getRollData` to be applied to bonus formulas.
   * @protected
   */
  _prepareHitPoints(rollData) {
    if (
      this.type !== "character" ||
      this.system._source.attributes.hp.max !== null
    )
      return;
    const hp = this.system.attributes.hp;

    const abilityId = CONFIG.SdS.hitPointsAbility || "con";
    const abilityMod = this.system.abilities[abilityId]?.mod ?? 0;
    const base = Object.values(this.classes).reduce((total, item) => {
      const advancement = item.advancement.byType.HitPoints?.[0];
      return total + (advancement?.getAdjustedTotal(abilityMod) ?? 0);
    }, 0);
    const levelBonus =
      simplifyBonus(hp.bonuses.level, rollData) * this.system.details.level;
    const overallBonus = simplifyBonus(hp.bonuses.overall, rollData);

    hp.max = base + levelBonus + overallBonus;
  }

  /* -------------------------------------------- */

  /**
   * Prepare the initiative data for an actor.
   * Mutates the value of the system.attributes.init object.
   * @param {object} bonusData         Data produced by getRollData to be applied to bonus formulas
   * @param {number} globalCheckBonus  Global ability check bonus
   * @protected
   */
  _prepareInitiative(bonusData, globalCheckBonus = 0) {
    const init = (this.system.attributes.init ??= {});
    const flags = this.flags.sds || {};

    // Compute initiative modifier
    const abilityId = init.ability || CONFIG.SdS.initiativeAbility;
    const ability = this.system.abilities?.[abilityId] || {};
    init.mod = ability.mod ?? 0;

    // Initiative proficiency
    const prof = this.system.attributes.prof ?? 0;
    const ra =
      flags.remarkableAthlete && ["str", "dex", "con"].includes(abilityId);
    init.prof = new Proficiency(
      prof,
      flags.jackOfAllTrades || ra ? 0.5 : 0,
      !ra
    );

    // Total initiative includes all numeric terms
    const initBonus = simplifyBonus(init.bonus, bonusData);
    const abilityBonus = simplifyBonus(ability.bonuses?.check, bonusData);
    init.total =
      init.mod +
      initBonus +
      abilityBonus +
      globalCheckBonus +
      (flags.initiativeAlert ? 5 : 0) +
      (Number.isNumeric(init.prof.term) ? init.prof.flat : 0);
  }

  /* -------------------------------------------- */
  /*  Spellcasting Preparation                    */
  /* -------------------------------------------- */

  /**
   * Prepare data related to the spell-casting capabilities of the Actor.
   * Mutates the value of the system.spells object.
   * @protected
   */
  _prepareSpellcasting() {
    if (!this.system.spells) return;

    // Spellcasting DC
    const spellcastingAbility =
      this.system.abilities[this.system.attributes.spellcasting];
    this.system.attributes.spelldc = spellcastingAbility
      ? spellcastingAbility.dc
      : 8 + this.system.attributes.prof;

    // Translate the list of classes into spellcasting progression
    const progression = { slot: 0, pact: 0 };
    const types = {};

    // NPCs don't get spell levels from classes
    if (this.type === "npc") {
      progression.slot = this.system.details.spellLevel ?? 0;
      types.leveled = 1;
    } else {
      // Grab all classes with spellcasting
      const classes = this.items.filter((cls) => {
        if (cls.type !== "class") return false;
        const type = cls.spellcasting.type;
        if (!type) return false;
        types[type] ??= 0;
        types[type] += 1;
        return true;
      });

      for (const cls of classes)
        this.constructor.computeClassProgression(progression, cls, {
          actor: this,
          count: types[cls.spellcasting.type],
        });
    }

    for (const type of Object.keys(CONFIG.SdS.spellcastingTypes)) {
      this.constructor.prepareSpellcastingSlots(
        this.system.spells,
        type,
        progression,
        { actor: this }
      );
    }
  }

  /* -------------------------------------------- */

  /**
   * Contribute to the actor's spellcasting progression.
   * @param {object} progression                             Spellcasting progression data. *Will be mutated.*
   * @param {Item5e} cls                                     Class for whom this progression is being computed.
   * @param {object} [config={}]
   * @param {Actor5e|null} [config.actor]                    Actor for whom the data is being prepared.
   * @param {SpellcastingDescription} [config.spellcasting]  Spellcasting descriptive object.
   * @param {number} [config.count=1]                        Number of classes with this type of spellcasting.
   */
  static computeClassProgression(
    progression,
    cls,
    { actor, spellcasting, count = 1 } = {}
  ) {
    const type = cls.spellcasting.type;
    spellcasting = spellcasting ?? cls.spellcasting;

    /**
     * A hook event that fires while computing the spellcasting progression for each class on each actor.
     * The actual hook names include the spellcasting type (e.g. `sds.computeLeveledProgression`).
     * @param {object} progression                    Spellcasting progression data. *Will be mutated.*
     * @param {Actor5e|null} [actor]                  Actor for whom the data is being prepared.
     * @param {Item5e} cls                            Class for whom this progression is being computed.
     * @param {SpellcastingDescription} spellcasting  Spellcasting descriptive object.
     * @param {number} count                          Number of classes with this type of spellcasting.
     * @returns {boolean}  Explicitly return false to prevent default progression from being calculated.
     * @function sds.computeSpellcastingProgression
     * @memberof hookEvents
     */
    const allowed = Hooks.call(
      `sds.compute${type.capitalize()}Progression`,
      progression,
      actor,
      cls,
      spellcasting,
      count
    );

    if (allowed && type === "pact") {
      this.computePactProgression(progression, actor, cls, spellcasting, count);
    } else if (allowed && type === "leveled") {
      this.computeLeveledProgression(
        progression,
        actor,
        cls,
        spellcasting,
        count
      );
    }
  }

  /* -------------------------------------------- */

  /**
   * Contribute to the actor's spellcasting progression for a class with leveled spellcasting.
   * @param {object} progression                    Spellcasting progression data. *Will be mutated.*
   * @param {Actor5e} actor                         Actor for whom the data is being prepared.
   * @param {Item5e} cls                            Class for whom this progression is being computed.
   * @param {SpellcastingDescription} spellcasting  Spellcasting descriptive object.
   * @param {number} count                          Number of classes with this type of spellcasting.
   */
  static computeLeveledProgression(
    progression,
    actor,
    cls,
    spellcasting,
    count
  ) {
    const prog =
      CONFIG.SdS.spellcastingTypes.leveled.progression[
        spellcasting.progression
      ];
    if (!prog) return;
    const rounding = prog.roundUp ? Math.ceil : Math.floor;
    progression.slot += rounding(spellcasting.levels / prog.divisor ?? 1);
    // Single-classed, non-full progression rounds up, rather than down.
    if (count === 1 && prog.divisor > 1 && progression.slot) {
      progression.slot = Math.ceil(spellcasting.levels / prog.divisor);
    }
  }

  /* -------------------------------------------- */

  /**
   * Contribute to the actor's spellcasting progression for a class with pact spellcasting.
   * @param {object} progression                    Spellcasting progression data. *Will be mutated.*
   * @param {Actor5e} actor                         Actor for whom the data is being prepared.
   * @param {Item5e} cls                            Class for whom this progression is being computed.
   * @param {SpellcastingDescription} spellcasting  Spellcasting descriptive object.
   * @param {number} count                          Number of classes with this type of spellcasting.
   */
  static computePactProgression(progression, actor, cls, spellcasting, count) {
    progression.pact += spellcasting.levels;
  }

  /* -------------------------------------------- */

  /**
   * Prepare actor's spell slots using progression data.
   * @param {object} spells           The `data.spells` object within actor's data. *Will be mutated.*
   * @param {string} type             Type of spellcasting slots being prepared.
   * @param {object} progression      Spellcasting progression data.
   * @param {object} [config]
   * @param {Actor5e} [config.actor]  Actor for whom the data is being prepared.
   */
  static prepareSpellcastingSlots(spells, type, progression, { actor } = {}) {
    /**
     * A hook event that fires to convert the provided spellcasting progression into spell slots.
     * The actual hook names include the spellcasting type (e.g. `sds.prepareLeveledSlots`).
     * @param {object} spells        The `data.spells` object within actor's data. *Will be mutated.*
     * @param {Actor5e} actor        Actor for whom the data is being prepared.
     * @param {object} progression   Spellcasting progression data.
     * @returns {boolean}            Explicitly return false to prevent default preparation from being performed.
     * @function sds.prepareSpellcastingSlots
     * @memberof hookEvents
     */
    const allowed = Hooks.call(
      `sds.prepare${type.capitalize()}Slots`,
      spells,
      actor,
      progression
    );

    if (allowed && type === "pact")
      this.preparePactSlots(spells, actor, progression);
    else if (allowed && type === "leveled")
      this.prepareLeveledSlots(spells, actor, progression);
  }

  /* -------------------------------------------- */

  /**
   * Prepare leveled spell slots using progression data.
   * @param {object} spells        The `data.spells` object within actor's data. *Will be mutated.*
   * @param {Actor5e} actor        Actor for whom the data is being prepared.
   * @param {object} progression   Spellcasting progression data.
   */
  static prepareLeveledSlots(spells, actor, progression) {
    const levels = Math.clamped(progression.slot, 0, CONFIG.SdS.maxLevel);
    const slots =
      CONFIG.SdS.SPELL_SLOT_TABLE[
        Math.min(levels, CONFIG.SdS.SPELL_SLOT_TABLE.length) - 1
      ] ?? [];
    for (const [n, slot] of Object.entries(spells)) {
      const level = parseInt(n.slice(-1));
      if (Number.isNaN(level)) continue;
      slot.max = Number.isNumeric(slot.override)
        ? Math.max(parseInt(slot.override), 0)
        : slots[level - 1] ?? 0;
      slot.value = parseInt(slot.value); // TODO: DataModels should remove the need for this
    }
  }

  /* -------------------------------------------- */

  /**
   * Prepare pact spell slots using progression data.
   * @param {object} spells        The `data.spells` object within actor's data. *Will be mutated.*
   * @param {Actor5e} actor        Actor for whom the data is being prepared.
   * @param {object} progression   Spellcasting progression data.
   */
  static preparePactSlots(spells, actor, progression) {
    // Pact spell data:
    // - pact.level: Slot level for pact casting
    // - pact.max: Total number of pact slots
    // - pact.value: Currently available pact slots
    // - pact.override: Override number of available spell slots

    let pactLevel = Math.clamped(progression.pact, 0, CONFIG.SdS.maxLevel);
    spells.pact ??= {};
    const override = Number.isNumeric(spells.pact.override)
      ? parseInt(spells.pact.override)
      : null;

    // Pact slot override
    if (pactLevel === 0 && actor.type === "npc" && override !== null) {
      pactLevel = actor.system.details.spellLevel;
    }

    // TODO: Allow pact level and slot count to be configured
    if (pactLevel > 0) {
      spells.pact.level = Math.ceil(Math.min(10, pactLevel) / 2); // TODO: Allow custom max pact level
      if (override === null) {
        spells.pact.max = Math.max(
          1,
          Math.min(pactLevel, 2),
          Math.min(pactLevel - 8, 3),
          Math.min(pactLevel - 13, 4)
        );
      } else {
        spells.pact.max = Math.max(override, 1);
      }
      spells.pact.value = Math.min(spells.pact.value, spells.pact.max);
    } else {
      spells.pact.max = override || 0;
      spells.pact.level = spells.pact.max > 0 ? 1 : 0;
    }
  }

  /* -------------------------------------------- */
  /*  Event Handlers                              */
  /* -------------------------------------------- */

  /** @inheritdoc */
  async _preCreate(data, options, user) {
    await super._preCreate(data, options, user);
    const sourceId = this.getFlag("core", "sourceId");
    if (sourceId?.startsWith("Compendium.")) return;

    // Configure prototype token settings
    if ("size" in (this.system.traits || {})) {
      const s = CONFIG.SdS.tokenSizes[this.system.traits.size || "med"];
      const prototypeToken = { width: s, height: s };
      if (this.type === "character")
        Object.assign(prototypeToken, {
          sight: { enabled: true },
          actorLink: true,
          disposition: 1,
        });
      this.updateSource({ prototypeToken });
    }
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async _preUpdate(changed, options, user) {
    await super._preUpdate(changed, options, user);

    // Apply changes in Actor size to Token width/height
    if ("size" in (this.system.traits || {})) {
      const newSize = foundry.utils.getProperty(changed, "system.traits.size");
      if (newSize && newSize !== this.system.traits?.size) {
        let size = CONFIG.SdS.tokenSizes[newSize];
        if (!foundry.utils.hasProperty(changed, "prototypeToken.width")) {
          changed.prototypeToken ||= {};
          changed.prototypeToken.height = size;
          changed.prototypeToken.width = size;
        }
      }
    }

    // Reset death save counters
    if ("hp" in (this.system.attributes || {})) {
      const isDead = this.system.attributes.hp.value <= 0;
      if (
        isDead &&
        foundry.utils.getProperty(changed, "system.attributes.hp.value") > 0
      ) {
        foundry.utils.setProperty(
          changed,
          "system.attributes.death.success",
          0
        );
        foundry.utils.setProperty(
          changed,
          "system.attributes.death.failure",
          0
        );
      }
    }
  }

  /* -------------------------------------------- */

  /**
   * Assign a class item as the original class for the Actor based on which class has the most levels.
   * @returns {Promise<Actor5e>}  Instance of the updated actor.
   * @protected
   */
  _assignPrimaryClass() {
    const classes = this.itemTypes.class.sort(
      (a, b) => b.system.levels - a.system.levels
    );
    const newPC = classes[0]?.id || "";
    return this.update({ "system.details.originalClass": newPC });
  }

  /* -------------------------------------------- */
  /*  Gameplay Mechanics                          */
  /* -------------------------------------------- */

  /** @override */
  async modifyTokenAttribute(attribute, value, isDelta, isBar) {
    if (attribute === "attributes.hp") {
      const hp = this.system.attributes.hp;
      const delta = isDelta ? -1 * value : hp.value + hp.temp - value;
      return this.applyDamage(delta);
    }
    return super.modifyTokenAttribute(attribute, value, isDelta, isBar);
  }

  /* -------------------------------------------- */

  /**
   * Apply a certain amount of damage or healing to the health pool for Actor
   * @param {number} amount       An amount of damage (positive) or healing (negative) to sustain
   * @param {number} multiplier   A multiplier which allows for resistance, vulnerability, or healing
   * @returns {Promise<Actor5e>}  A Promise which resolves once the damage has been applied
   */
  async applyDamage(amount = 0, multiplier = 1) {
    amount = Math.floor(parseInt(amount) * multiplier);
    const hp = this.system.attributes.hp;
    if (!hp) return this; // Group actors don't have HP at the moment

    // Deduct damage from temp HP first
    const tmp = parseInt(hp.temp) || 0;
    const dt = amount > 0 ? Math.min(tmp, amount) : 0;

    // Remaining goes to health
    const tmpMax = parseInt(hp.tempmax) || 0;
    const dh = Math.clamped(hp.value - (amount - dt), 0, hp.max + tmpMax);

    // Update the Actor
    const updates = {
      "system.attributes.hp.temp": tmp - dt,
      "system.attributes.hp.value": dh,
    };

    // Delegate damage application to a hook
    // TODO replace this in the future with a better modifyTokenAttribute function in the core
    const allowed = Hooks.call(
      "modifyTokenAttribute",
      {
        attribute: "attributes.hp",
        value: amount,
        isDelta: false,
        isBar: true,
      },
      updates
    );
    return allowed !== false ? this.update(updates, { dhp: -amount }) : this;
  }

  /* -------------------------------------------- */

  /**
   * Apply a certain amount of temporary hit point, but only if it's more than the actor currently has.
   * @param {number} amount       An amount of temporary hit points to set
   * @returns {Promise<Actor5e>}  A Promise which resolves once the temp HP has been applied
   */
  async applyTempHP(amount = 0) {
    amount = parseInt(amount);
    const hp = this.system.attributes.hp;

    // Update the actor if the new amount is greater than the current
    const tmp = parseInt(hp.temp) || 0;
    return amount > tmp
      ? this.update({ "system.attributes.hp.temp": amount })
      : this;
  }

  /* -------------------------------------------- */

  /**
   * Get a color used to represent the current hit points of an Actor.
   * @param {number} current        The current HP value
   * @param {number} max            The maximum HP value
   * @returns {Color}               The color used to represent the HP percentage
   */
  static getHPColor(current, max) {
    const pct = Math.clamped(current, 0, max) / max;
    return Color.fromRGB([1 - pct / 2, pct, 0]);
  }

  /* -------------------------------------------- */

  /**
   * Determine whether the provided ability is usable for remarkable athlete.
   * @param {string} ability  Ability type to check.
   * @returns {boolean}       Whether the actor has the remarkable athlete flag and the ability is physical.
   * @private
   */
  _isRemarkableAthlete(ability) {
    return (
      this.getFlag("sds", "remarkableAthlete") &&
      CONFIG.SdS.characterFlags.remarkableAthlete.abilities.includes(ability)
    );
  }

  /* -------------------------------------------- */
  /*  Rolling                                     */
  /* -------------------------------------------- */

  /**
   * Roll a Skill Check
   * Prompt the user for input regarding Advantage/Disadvantage and any Situational Bonus
   * @param {string} skillId      The skill id (e.g. "ins")
   * @param {object} options      Options which configure how the skill check is rolled
   * @returns {Promise<D20Roll>}  A Promise which resolves to the created Roll instance
   */
  async rollSkill(skillId, options = {}) {
    const skl = this.system.skills[skillId];
    const abl = this.system.abilities[skl.ability];
    const globalBonuses = this.system.bonuses?.abilities ?? {};
    const parts = ["@mod", "@abilityCheckBonus"];
    const data = this.getRollData();

    // Add ability modifier
    data.mod = skl.mod;
    data.defaultAbility = skl.ability;

    // Include proficiency bonus
    if (skl.prof.hasProficiency) {
      parts.push("@prof");
      data.prof = skl.prof.term;
    }

    // Global ability check bonus
    if (globalBonuses.check) {
      parts.push("@checkBonus");
      data.checkBonus = Roll.replaceFormulaData(globalBonuses.check, data);
    }

    // Ability-specific check bonus
    if (abl?.bonuses?.check)
      data.abilityCheckBonus = Roll.replaceFormulaData(abl.bonuses.check, data);
    else data.abilityCheckBonus = 0;

    // Skill-specific skill bonus
    if (skl.bonuses?.check) {
      const checkBonusKey = `${skillId}CheckBonus`;
      parts.push(`@${checkBonusKey}`);
      data[checkBonusKey] = Roll.replaceFormulaData(skl.bonuses.check, data);
    }

    // Global skill check bonus
    if (globalBonuses.skill) {
      parts.push("@skillBonus");
      data.skillBonus = Roll.replaceFormulaData(globalBonuses.skill, data);
    }

    // Reliable Talent applies to any skill check we have full or better proficiency in
    const reliableTalent =
      skl.value >= 1 && this.getFlag("sds", "reliableTalent");

    // Roll and return
    const flavor = game.i18n.format("SdS.SkillPromptTitle", {
      skill: CONFIG.SdS.skills[skillId]?.label ?? "",
    });
    const rollData = foundry.utils.mergeObject(
      {
        data: data,
        title: `${flavor}: ${this.name}`,
        flavor,
        chooseModifier: true,
        halflingLucky: this.getFlag("sds", "halflingLucky"),
        reliableTalent,
        messageData: {
          speaker: options.speaker || ChatMessage.getSpeaker({ actor: this }),
          "flags.sds.roll": { type: "skill", skillId },
        },
      },
      options
    );
    rollData.parts = parts.concat(options.parts ?? []);

    /**
     * A hook event that fires before a skill check is rolled for an Actor.
     * @function sds.preRollSkill
     * @memberof hookEvents
     * @param {Actor5e} actor                Actor for which the skill check is being rolled.
     * @param {D20RollConfiguration} config  Configuration data for the pending roll.
     * @param {string} skillId               ID of the skill being rolled as defined in `SdS.skills`.
     * @returns {boolean}                    Explicitly return `false` to prevent skill check from being rolled.
     */
    if (Hooks.call("sds.preRollSkill", this, rollData, skillId) === false)
      return;

    const roll = await d20Roll(rollData);

    /**
     * A hook event that fires after a skill check has been rolled for an Actor.
     * @function sds.rollSkill
     * @memberof hookEvents
     * @param {Actor5e} actor   Actor for which the skill check has been rolled.
     * @param {D20Roll} roll    The resulting roll.
     * @param {string} skillId  ID of the skill that was rolled as defined in `SdS.skills`.
     */
    if (roll) Hooks.callAll("sds.rollSkill", this, roll, skillId);

    return roll;
  }

  /* -------------------------------------------- */

  /**
   * Roll a generic ability test or saving throw.
   * Prompt the user for input on which variety of roll they want to do.
   * @param {string} abilityId    The ability id (e.g. "str")
   * @param {object} options      Options which configure how ability tests or saving throws are rolled
   */
  rollAbility(abilityId, options = {}) {
    const label = CONFIG.SdS.abilities[abilityId] ?? "";
    new Dialog({
      title: `${game.i18n.format("SdS.AbilityPromptTitle", {
        ability: label,
      })}: ${this.name}`,
      content: `<p>${game.i18n.format("SdS.AbilityPromptText", {
        ability: label,
      })}</p>`,
      buttons: {
        test: {
          label: game.i18n.localize("SdS.ActionAbil"),
          callback: () => this.rollAbilityTest(abilityId, options),
        },
        save: {
          label: game.i18n.localize("SdS.ActionSave"),
          callback: () => this.rollAbilitySave(abilityId, options),
        },
      },
    }).render(true);
  }

  /* -------------------------------------------- */

  /**
   * Roll an Ability Test
   * Prompt the user for input regarding Advantage/Disadvantage and any Situational Bonus
   * @param {string} abilityId    The ability ID (e.g. "str")
   * @param {object} options      Options which configure how ability tests are rolled
   * @returns {Promise<D20Roll>}  A Promise which resolves to the created Roll instance
   */
  async rollAbilityTest(abilityId, options = {}) {
    const label = CONFIG.SdS.abilities[abilityId] ?? "";
    const abl = this.system.abilities[abilityId];
    const globalBonuses = this.system.bonuses?.abilities ?? {};
    const parts = [];
    const data = this.getRollData();

    // Add ability modifier
    parts.push("@mod");
    data.mod = abl?.mod ?? 0;

    // Include proficiency bonus
    if (abl?.checkProf.hasProficiency) {
      parts.push("@prof");
      data.prof = abl.checkProf.term;
    }

    // Add ability-specific check bonus
    if (abl?.bonuses?.check) {
      const checkBonusKey = `${abilityId}CheckBonus`;
      parts.push(`@${checkBonusKey}`);
      data[checkBonusKey] = Roll.replaceFormulaData(abl.bonuses.check, data);
    }

    // Add global actor bonus
    if (globalBonuses.check) {
      parts.push("@checkBonus");
      data.checkBonus = Roll.replaceFormulaData(globalBonuses.check, data);
    }

    // Roll and return
    const flavor = game.i18n.format("SdS.AbilityPromptTitle", {
      ability: label,
    });
    const rollData = foundry.utils.mergeObject(
      {
        data,
        title: `${flavor}: ${this.name}`,
        flavor,
        halflingLucky: this.getFlag("sds", "halflingLucky"),
        messageData: {
          speaker: options.speaker || ChatMessage.getSpeaker({ actor: this }),
          "flags.sds.roll": { type: "ability", abilityId },
        },
      },
      options
    );
    rollData.parts = parts.concat(options.parts ?? []);

    /**
     * A hook event that fires before an ability test is rolled for an Actor.
     * @function sds.preRollAbilityTest
     * @memberof hookEvents
     * @param {Actor5e} actor                Actor for which the ability test is being rolled.
     * @param {D20RollConfiguration} config  Configuration data for the pending roll.
     * @param {string} abilityId             ID of the ability being rolled as defined in `SdS.abilities`.
     * @returns {boolean}                    Explicitly return `false` to prevent ability test from being rolled.
     */
    if (
      Hooks.call("sds.preRollAbilityTest", this, rollData, abilityId) === false
    )
      return;

    const roll = await d20Roll(rollData);

    /**
     * A hook event that fires after an ability test has been rolled for an Actor.
     * @function sds.rollAbilityTest
     * @memberof hookEvents
     * @param {Actor5e} actor     Actor for which the ability test has been rolled.
     * @param {D20Roll} roll      The resulting roll.
     * @param {string} abilityId  ID of the ability that was rolled as defined in `SdS.abilities`.
     */
    if (roll) Hooks.callAll("sds.rollAbilityTest", this, roll, abilityId);

    return roll;
  }

  /* -------------------------------------------- */

  /**
   * Roll an Ability Saving Throw
   * Prompt the user for input regarding Advantage/Disadvantage and any Situational Bonus
   * @param {string} abilityId    The ability ID (e.g. "str")
   * @param {object} options      Options which configure how ability tests are rolled
   * @returns {Promise<D20Roll>}  A Promise which resolves to the created Roll instance
   */
  async rollAbilitySave(abilityId, options = {}) {
    const label = CONFIG.SdS.abilities[abilityId] ?? "";
    const abl = this.system.abilities[abilityId];
    const globalBonuses = this.system.bonuses?.abilities ?? {};
    const parts = [];
    const data = this.getRollData();

    // Add ability modifier
    parts.push("@mod");
    data.mod = abl?.mod ?? 0;

    // Include proficiency bonus
    if (abl?.saveProf.hasProficiency) {
      parts.push("@prof");
      data.prof = abl.saveProf.term;
    }

    // Include ability-specific saving throw bonus
    if (abl?.bonuses?.save) {
      const saveBonusKey = `${abilityId}SaveBonus`;
      parts.push(`@${saveBonusKey}`);
      data[saveBonusKey] = Roll.replaceFormulaData(abl.bonuses.save, data);
    }

    // Include a global actor ability save bonus
    if (globalBonuses.save) {
      parts.push("@saveBonus");
      data.saveBonus = Roll.replaceFormulaData(globalBonuses.save, data);
    }

    // Roll and return
    const flavor = game.i18n.format("SdS.SavePromptTitle", {
      ability: label,
    });
    const rollData = foundry.utils.mergeObject(
      {
        data,
        title: `${flavor}: ${this.name}`,
        flavor,
        halflingLucky: this.getFlag("sds", "halflingLucky"),
        messageData: {
          speaker: options.speaker || ChatMessage.getSpeaker({ actor: this }),
          "flags.sds.roll": { type: "save", abilityId },
        },
      },
      options
    );
    rollData.parts = parts.concat(options.parts ?? []);

    /**
     * A hook event that fires before an ability save is rolled for an Actor.
     * @function sds.preRollAbilitySave
     * @memberof hookEvents
     * @param {Actor5e} actor                Actor for which the ability save is being rolled.
     * @param {D20RollConfiguration} config  Configuration data for the pending roll.
     * @param {string} abilityId             ID of the ability being rolled as defined in `SdS.abilities`.
     * @returns {boolean}                    Explicitly return `false` to prevent ability save from being rolled.
     */
    if (
      Hooks.call("sds.preRollAbilitySave", this, rollData, abilityId) === false
    )
      return;

    const roll = await d20Roll(rollData);

    /**
     * A hook event that fires after an ability save has been rolled for an Actor.
     * @function sds.rollAbilitySave
     * @memberof hookEvents
     * @param {Actor5e} actor     Actor for which the ability save has been rolled.
     * @param {D20Roll} roll      The resulting roll.
     * @param {string} abilityId  ID of the ability that was rolled as defined in `SdS.abilities`.
     */
    if (roll) Hooks.callAll("sds.rollAbilitySave", this, roll, abilityId);

    return roll;
  }

  /* -------------------------------------------- */

  /**
   * Perform a death saving throw, rolling a d20 plus any global save bonuses
   * @param {object} options          Additional options which modify the roll
   * @returns {Promise<D20Roll|null>} A Promise which resolves to the Roll instance
   */
  async rollDeathSave(options = {}) {
    const death = this.system.attributes.death;

    // Display a warning if we are not at zero HP or if we already have reached 3
    if (
      this.system.attributes.hp.value > 0 ||
      death.failure >= 3 ||
      death.success >= 3
    ) {
      ui.notifications.warn(game.i18n.localize("SdS.DeathSaveUnnecessary"));
      return null;
    }

    // Evaluate a global saving throw bonus
    const speaker = options.speaker || ChatMessage.getSpeaker({ actor: this });
    const globalBonuses = this.system.bonuses?.abilities ?? {};
    const parts = [];
    const data = this.getRollData();

    // Diamond Soul adds proficiency
    if (this.getFlag("sds", "diamondSoul")) {
      parts.push("@prof");
      data.prof = new Proficiency(this.system.attributes.prof, 1).term;
    }

    // Include a global actor ability save bonus
    if (globalBonuses.save) {
      parts.push("@saveBonus");
      data.saveBonus = Roll.replaceFormulaData(globalBonuses.save, data);
    }

    // Evaluate the roll
    const flavor = game.i18n.localize("SdS.DeathSavingThrow");
    const rollData = foundry.utils.mergeObject(
      {
        data,
        title: `${flavor}: ${this.name}`,
        flavor,
        halflingLucky: this.getFlag("sds", "halflingLucky"),
        targetValue: 10,
        messageData: {
          speaker: speaker,
          "flags.sds.roll": { type: "death" },
        },
      },
      options
    );
    rollData.parts = parts.concat(options.parts ?? []);

    /**
     * A hook event that fires before a death saving throw is rolled for an Actor.
     * @function sds.preRollDeathSave
     * @memberof hookEvents
     * @param {Actor5e} actor                Actor for which the death saving throw is being rolled.
     * @param {D20RollConfiguration} config  Configuration data for the pending roll.
     * @returns {boolean}                    Explicitly return `false` to prevent death saving throw from being rolled.
     */
    if (Hooks.call("sds.preRollDeathSave", this, rollData) === false) return;

    const roll = await d20Roll(rollData);
    if (!roll) return null;

    // Take action depending on the result
    const details = {};

    // Save success
    if (roll.total >= (roll.options.targetValue ?? 10)) {
      let successes = (death.success || 0) + 1;

      // Critical Success = revive with 1hp
      if (roll.isCritical) {
        details.updates = {
          "system.attributes.death.success": 0,
          "system.attributes.death.failure": 0,
          "system.attributes.hp.value": 1,
        };
        details.chatString = "SdS.DeathSaveCriticalSuccess";
      }

      // 3 Successes = survive and reset checks
      else if (successes === 3) {
        details.updates = {
          "system.attributes.death.success": 0,
          "system.attributes.death.failure": 0,
        };
        details.chatString = "SdS.DeathSaveSuccess";
      }

      // Increment successes
      else
        details.updates = {
          "system.attributes.death.success": Math.clamped(successes, 0, 3),
        };
    }

    // Save failure
    else {
      let failures = (death.failure || 0) + (roll.isFumble ? 2 : 1);
      details.updates = {
        "system.attributes.death.failure": Math.clamped(failures, 0, 3),
      };
      if (failures >= 3) {
        // 3 Failures = death
        details.chatString = "SdS.DeathSaveFailure";
      }
    }

    /**
     * A hook event that fires after a death saving throw has been rolled for an Actor, but before
     * updates have been performed.
     * @function sds.rollDeathSave
     * @memberof hookEvents
     * @param {Actor5e} actor              Actor for which the death saving throw has been rolled.
     * @param {D20Roll} roll               The resulting roll.
     * @param {object} details
     * @param {object} details.updates     Updates that will be applied to the actor as a result of this save.
     * @param {string} details.chatString  Localizable string displayed in the create chat message. If not set, then
     *                                     no chat message will be displayed.
     * @returns {boolean}                  Explicitly return `false` to prevent updates from being performed.
     */
    if (Hooks.call("sds.rollDeathSave", this, roll, details) === false)
      return roll;

    if (!foundry.utils.isEmpty(details.updates))
      await this.update(details.updates);

    // Display success/failure chat message
    if (details.chatString) {
      let chatData = {
        content: game.i18n.format(details.chatString, { name: this.name }),
        speaker,
      };
      ChatMessage.applyRollMode(chatData, roll.options.rollMode);
      await ChatMessage.create(chatData);
    }

    // Return the rolled result
    return roll;
  }

  /* -------------------------------------------- */

  /**
   * Get an un-evaluated D20Roll instance used to roll initiative for this Actor.
   * @param {object} [options]                        Options which modify the roll
   * @param {D20Roll.ADV_MODE} [options.advantageMode]    A specific advantage mode to apply
   * @param {string} [options.flavor]                     Special flavor text to apply
   * @returns {D20Roll}                               The constructed but unevaluated D20Roll
   */
  getInitiativeRoll(options = {}) {
    // Use a temporarily cached initiative roll
    if (this._cachedInitiativeRoll) return this._cachedInitiativeRoll.clone();

    // Obtain required data
    const init = this.system.attributes?.init;
    const abilityId = init?.ability || CONFIG.SdS.initiativeAbility;
    const data = this.getRollData();
    const flags = this.flags.sds || {};
    if (flags.initiativeAdv)
      options.advantageMode ??= sds.dice.D20Roll.ADV_MODE.ADVANTAGE;

    // Standard initiative formula
    const parts = ["1d20"];

    // Special initiative bonuses
    if (init) {
      parts.push(init.mod);
      if (init.prof.term !== "0") {
        parts.push("@prof");
        data.prof = init.prof.term;
      }
      if (init.bonus !== 0) {
        parts.push("@bonus");
        data.bonus = init.bonus;
      }
    }

    // Ability check bonuses
    if ("abilities" in this.system) {
      const abilityBonus = this.system.abilities[abilityId]?.bonuses?.check;
      if (abilityBonus) {
        parts.push("@abilityBonus");
        data.abilityBonus = abilityBonus;
      }
    }

    // Global check bonus
    if ("bonuses" in this.system) {
      const globalCheckBonus = this.system.bonuses.abilities?.check;
      if (globalCheckBonus) {
        parts.push("@globalBonus");
        data.globalBonus = globalCheckBonus;
      }
    }

    // Alert feat
    if (flags.initiativeAlert) {
      parts.push("@alertBonus");
      data.alertBonus = 5;
    }

    // Ability score tiebreaker
    const tiebreaker = game.settings.get("sds", "initiativeDexTiebreaker");
    if (tiebreaker && "abilities" in this.system) {
      const abilityValue = this.system.abilities[abilityId]?.value;
      if (Number.isNumeric(abilityValue))
        parts.push(String(abilityValue / 100));
    }

    options = foundry.utils.mergeObject(
      {
        flavor: options.flavor ?? game.i18n.localize("SdS.Initiative"),
        halflingLucky: flags.halflingLucky ?? false,
        critical: null,
        fumble: null,
      },
      options
    );

    // Create the d20 roll
    const formula = parts.join(" + ");
    return new CONFIG.Dice.D20Roll(formula, data, options);
  }

  /* -------------------------------------------- */

  /**
   * Roll initiative for this Actor with a dialog that provides an opportunity to elect advantage or other bonuses.
   * @param {object} [rollOptions]      Options forwarded to the Actor#getInitiativeRoll method
   * @returns {Promise<void>}           A promise which resolves once initiative has been rolled for the Actor
   */
  async rollInitiativeDialog(rollOptions = {}) {
    // Create and configure the Initiative roll
    const roll = this.getInitiativeRoll(rollOptions);
    const choice = await roll.configureDialog({
      defaultRollMode: game.settings.get("core", "rollMode"),
      title: `${game.i18n.localize("SdS.InitiativeRoll")}: ${this.name}`,
      chooseModifier: false,
      defaultAction:
        rollOptions.advantageMode ?? sds.dice.D20Roll.ADV_MODE.NORMAL,
    });
    if (choice === null) return; // Closed dialog

    // Temporarily cache the configured roll and use it to roll initiative for the Actor
    this._cachedInitiativeRoll = roll;
    await this.rollInitiative({ createCombatants: true });
    delete this._cachedInitiativeRoll;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async rollInitiative(options = {}) {
    /**
     * A hook event that fires before initiative is rolled for an Actor.
     * @function sds.preRollInitiative
     * @memberof hookEvents
     * @param {Actor5e} actor  The Actor that is rolling initiative.
     * @param {D20Roll} roll   The initiative roll.
     */
    if (
      Hooks.call("sds.preRollInitiative", this, this._cachedInitiativeRoll) ===
      false
    )
      return;

    const combat = await super.rollInitiative(options);
    const combatants = this.isToken
      ? this.getActiveTokens(false, true).reduce((arr, t) => {
          const combatant = game.combat.getCombatantByToken(t.id);
          if (combatant) arr.push(combatant);
          return arr;
        }, [])
      : [game.combat.getCombatantByActor(this.id)];

    /**
     * A hook event that fires after an Actor has rolled for initiative.
     * @function sds.rollInitiative
     * @memberof hookEvents
     * @param {Actor5e} actor           The Actor that rolled initiative.
     * @param {Combatant[]} combatants  The associated Combatants in the Combat.
     */
    Hooks.callAll("sds.rollInitiative", this, combatants);
    return combat;
  }

  /* -------------------------------------------- */

  /**
   * Roll a hit die of the appropriate type, gaining hit points equal to the die roll plus your CON modifier.
   * @param {string} [denomination]  The hit denomination of hit die to roll. Example "d8".
   *                                 If no denomination is provided, the first available HD will be used
   * @param {object} options         Additional options which modify the roll.
   * @returns {Promise<Roll|null>}   The created Roll instance, or null if no hit die was rolled
   */
  async rollHitDie(denomination, options = {}) {
    // If no denomination was provided, choose the first available
    let cls = null;
    if (!denomination) {
      cls = this.itemTypes.class.find(
        (c) => c.system.hitDiceUsed < c.system.levels
      );
      if (!cls) return null;
      denomination = cls.system.hitDice;
    }

    // Otherwise, locate a class (if any) which has an available hit die of the requested denomination
    else
      cls = this.items.find((i) => {
        return (
          i.system.hitDice === denomination &&
          (i.system.hitDiceUsed || 0) < (i.system.levels || 1)
        );
      });

    // If no class is available, display an error notification
    if (!cls) {
      ui.notifications.error(
        game.i18n.format("SdS.HitDiceWarn", {
          name: this.name,
          formula: denomination,
        })
      );
      return null;
    }

    // Prepare roll data
    const flavor = game.i18n.localize("SdS.HitDiceRoll");
    const rollConfig = foundry.utils.mergeObject(
      {
        formula: `max(0, 1${denomination} + @abilities.con.mod)`,
        data: this.getRollData(),
        chatMessage: true,
        messageData: {
          speaker: ChatMessage.getSpeaker({ actor: this }),
          flavor,
          title: `${flavor}: ${this.name}`,
          rollMode: game.settings.get("core", "rollMode"),
          "flags.sds.roll": { type: "hitDie" },
        },
      },
      options
    );

    /**
     * A hook event that fires before a hit die is rolled for an Actor.
     * @function sds.preRollHitDie
     * @memberof hookEvents
     * @param {Actor5e} actor               Actor for which the hit die is to be rolled.
     * @param {object} config               Configuration data for the pending roll.
     * @param {string} config.formula       Formula that will be rolled.
     * @param {object} config.data          Data used when evaluating the roll.
     * @param {boolean} config.chatMessage  Should a chat message be created for this roll?
     * @param {object} config.messageData   Data used to create the chat message.
     * @param {string} denomination         Size of hit die to be rolled.
     * @returns {boolean}                   Explicitly return `false` to prevent hit die from being rolled.
     */
    if (
      Hooks.call("sds.preRollHitDie", this, rollConfig, denomination) === false
    )
      return;

    const roll = await new Roll(rollConfig.formula, rollConfig.data).roll({
      async: true,
    });
    if (rollConfig.chatMessage) roll.toMessage(rollConfig.messageData);

    const hp = this.system.attributes.hp;
    const dhp = Math.min(hp.max + (hp.tempmax ?? 0) - hp.value, roll.total);
    const updates = {
      actor: { "system.attributes.hp.value": hp.value + dhp },
      class: { "system.hitDiceUsed": cls.system.hitDiceUsed + 1 },
    };

    /**
     * A hook event that fires after a hit die has been rolled for an Actor, but before updates have been performed.
     * @function sds.rollHitDie
     * @memberof hookEvents
     * @param {Actor5e} actor         Actor for which the hit die has been rolled.
     * @param {Roll} roll             The resulting roll.
     * @param {object} updates
     * @param {object} updates.actor  Updates that will be applied to the actor.
     * @param {object} updates.class  Updates that will be applied to the class.
     * @returns {boolean}             Explicitly return `false` to prevent updates from being performed.
     */
    if (Hooks.call("sds.rollHitDie", this, roll, updates) === false)
      return roll;

    // Re-evaluate dhp in the event that it was changed in the previous hook
    const updateOptions = {
      dhp:
        (updates.actor?.["system.attributes.hp.value"] ?? hp.value) - hp.value,
    };

    // Perform updates
    if (!foundry.utils.isEmpty(updates.actor))
      await this.update(updates.actor, updateOptions);
    if (!foundry.utils.isEmpty(updates.class)) await cls.update(updates.class);

    return roll;
  }

  /* -------------------------------------------- */

  /**
   * Roll hit points for a specific class as part of a level-up workflow.
   * @param {Item5e} item                         The class item whose hit dice to roll.
   * @param {object} options
   * @param {boolean} [options.chatMessage=true]  Display the chat message for this roll.
   * @returns {Promise<Roll>}                     The completed roll.
   * @see {@link sds.preRollClassHitPoints}
   */
  async rollClassHitPoints(item, { chatMessage = true } = {}) {
    if (item.type !== "class")
      throw new Error("Hit points can only be rolled for a class item.");
    const rollData = {
      formula: `1${item.system.hitDice}`,
      data: item.getRollData(),
      chatMessage,
    };
    const flavor = game.i18n.format("SdS.AdvancementHitPointsRollMessage", {
      class: item.name,
    });
    const messageData = {
      title: `${flavor}: ${this.name}`,
      flavor,
      speaker: ChatMessage.getSpeaker({ actor: this }),
      "flags.sds.roll": { type: "hitPoints" },
    };

    /**
     * A hook event that fires before hit points are rolled for a character's class.
     * @function sds.preRollClassHitPoints
     * @memberof hookEvents
     * @param {Actor5e} actor            Actor for which the hit points are being rolled.
     * @param {Item5e} item              The class item whose hit dice will be rolled.
     * @param {object} rollData
     * @param {string} rollData.formula  The string formula to parse.
     * @param {object} rollData.data     The data object against which to parse attributes within the formula.
     * @param {object} messageData       The data object to use when creating the message.
     */
    Hooks.callAll(
      "sds.preRollClassHitPoints",
      this,
      item,
      rollData,
      messageData
    );

    const roll = new Roll(rollData.formula, rollData.data);
    await roll.evaluate({ async: true });

    /**
     * A hook event that fires after hit points haven been rolled for a character's class.
     * @function sds.rollClassHitPoints
     * @memberof hookEvents
     * @param {Actor5e} actor  Actor for which the hit points have been rolled.
     * @param {Roll} roll      The resulting roll.
     */
    Hooks.callAll("sds.rollClassHitPoints", this, roll);

    if (rollData.chatMessage) await roll.toMessage(messageData);
    return roll;
  }

  /* -------------------------------------------- */

  /**
   * Roll hit points for an NPC based on the HP formula.
   * @param {object} options
   * @param {boolean} [options.chatMessage=true]  Display the chat message for this roll.
   * @returns {Promise<Roll>}                     The completed roll.
   * @see {@link sds.preRollNPCHitPoints}
   */
  async rollNPCHitPoints({ chatMessage = true } = {}) {
    if (this.type !== "npc")
      throw new Error("NPC hit points can only be rolled for NPCs");
    const rollData = {
      formula: this.system.attributes.hp.formula,
      data: this.getRollData(),
      chatMessage,
    };
    const flavor = game.i18n.format("SdS.HPFormulaRollMessage");
    const messageData = {
      title: `${flavor}: ${this.name}`,
      flavor,
      speaker: ChatMessage.getSpeaker({ actor: this }),
      "flags.sds.roll": { type: "hitPoints" },
    };

    /**
     * A hook event that fires before hit points are rolled for an NPC.
     * @function sds.preRollNPCHitPoints
     * @memberof hookEvents
     * @param {Actor5e} actor            Actor for which the hit points are being rolled.
     * @param {object} rollData
     * @param {string} rollData.formula  The string formula to parse.
     * @param {object} rollData.data     The data object against which to parse attributes within the formula.
     * @param {object} messageData       The data object to use when creating the message.
     */
    Hooks.callAll("sds.preRollNPCHitPoints", this, rollData, messageData);

    const roll = new Roll(rollData.formula, rollData.data);
    await roll.evaluate({ async: true });

    /**
     * A hook event that fires after hit points are rolled for an NPC.
     * @function sds.rollNPCHitPoints
     * @memberof hookEvents
     * @param {Actor5e} actor  Actor for which the hit points have been rolled.
     * @param {Roll} roll      The resulting roll.
     */
    Hooks.callAll("sds.rollNPCHitPoints", this, roll);

    if (rollData.chatMessage) await roll.toMessage(messageData);
    return roll;
  }

  /* -------------------------------------------- */
  /*  Resting                                     */
  /* -------------------------------------------- */

  /**
   * Configuration options for a rest.
   *
   * @typedef {object} RestConfiguration
   * @property {boolean} dialog            Present a dialog window which allows for rolling hit dice as part of the
   *                                       Short Rest and selecting whether a new day has occurred.
   * @property {boolean} chat              Should a chat message be created to summarize the results of the rest?
   * @property {boolean} newDay            Does this rest carry over to a new day?
   * @property {boolean} [autoHD]          Should hit dice be spent automatically during a short rest?
   * @property {number} [autoHDThreshold]  How many hit points should be missing before hit dice are
   *                                       automatically spent during a short rest.
   */

  /**
   * Results from a rest operation.
   *
   * @typedef {object} RestResult
   * @property {number} dhp            Hit points recovered during the rest.
   * @property {number} dhd            Hit dice recovered or spent during the rest.
   * @property {object} updateData     Updates applied to the actor.
   * @property {object[]} updateItems  Updates applied to actor's items.
   * @property {boolean} longRest      Whether the rest type was a long rest.
   * @property {boolean} newDay        Whether a new day occurred during the rest.
   * @property {Roll[]} rolls          Any rolls that occurred during the rest process, not including hit dice.
   */

  /* -------------------------------------------- */

  /**
   * Take a short rest, possibly spending hit dice and recovering resources, item uses, and pact slots.
   * @param {RestConfiguration} [config]  Configuration options for a short rest.
   * @returns {Promise<RestResult>}       A Promise which resolves once the short rest workflow has completed.
   */
  async shortRest(config = {}) {
    config = foundry.utils.mergeObject(
      {
        dialog: true,
        chat: true,
        newDay: false,
        autoHD: false,
        autoHDThreshold: 3,
      },
      config
    );

    /**
     * A hook event that fires before a short rest is started.
     * @function sds.preShortRest
     * @memberof hookEvents
     * @param {Actor5e} actor             The actor that is being rested.
     * @param {RestConfiguration} config  Configuration options for the rest.
     * @returns {boolean}                 Explicitly return `false` to prevent the rest from being started.
     */
    if (Hooks.call("sds.preShortRest", this, config) === false) return;

    // Take note of the initial hit points and number of hit dice the Actor has
    const hd0 = this.system.attributes.hd;
    const hp0 = this.system.attributes.hp.value;

    // Display a Dialog for rolling hit dice
    if (config.dialog) {
      try {
        config.newDay = await ShortRestDialog.shortRestDialog({
          actor: this,
          canRoll: hd0 > 0,
        });
      } catch (err) {
        return;
      }
    }

    // Automatically spend hit dice
    else if (config.autoHD)
      await this.autoSpendHitDice({ threshold: config.autoHDThreshold });

    // Return the rest result
    const dhd = this.system.attributes.hd - hd0;
    const dhp = this.system.attributes.hp.value - hp0;
    return this._rest(config.chat, config.newDay, false, dhd, dhp);
  }

  /* -------------------------------------------- */

  /**
   * Take a long rest, recovering hit points, hit dice, resources, item uses, and spell slots.
   * @param {RestConfiguration} [config]  Configuration options for a long rest.
   * @returns {Promise<RestResult>}       A Promise which resolves once the long rest workflow has completed.
   */
  async longRest(config = {}) {
    config = foundry.utils.mergeObject(
      {
        dialog: true,
        chat: true,
        newDay: true,
      },
      config
    );

    /**
     * A hook event that fires before a long rest is started.
     * @function sds.preLongRest
     * @memberof hookEvents
     * @param {Actor5e} actor             The actor that is being rested.
     * @param {RestConfiguration} config  Configuration options for the rest.
     * @returns {boolean}                 Explicitly return `false` to prevent the rest from being started.
     */
    if (Hooks.call("sds.preLongRest", this, config) === false) return;

    if (config.dialog) {
      try {
        config.newDay = await LongRestDialog.longRestDialog({ actor: this });
      } catch (err) {
        return;
      }
    }

    return this._rest(config.chat, config.newDay, true);
  }

  /* -------------------------------------------- */

  /**
   * Perform all of the changes needed for a short or long rest.
   *
   * @param {boolean} chat           Summarize the results of the rest workflow as a chat message.
   * @param {boolean} newDay         Has a new day occurred during this rest?
   * @param {boolean} longRest       Is this a long rest?
   * @param {number} [dhd=0]         Number of hit dice spent during so far during the rest.
   * @param {number} [dhp=0]         Number of hit points recovered so far during the rest.
   * @returns {Promise<RestResult>}  Consolidated results of the rest workflow.
   * @private
   */
  async _rest(chat, newDay, longRest, dhd = 0, dhp = 0) {
    let hitPointsRecovered = 0;
    let hitPointUpdates = {};
    let hitDiceRecovered = 0;
    let hitDiceUpdates = [];
    const rolls = [];

    // Recover hit points & hit dice on long rest
    if (longRest) {
      ({ updates: hitPointUpdates, hitPointsRecovered } =
        this._getRestHitPointRecovery());
      ({ updates: hitDiceUpdates, hitDiceRecovered } =
        this._getRestHitDiceRecovery());
    }

    // Figure out the rest of the changes
    const result = {
      dhd: dhd + hitDiceRecovered,
      dhp: dhp + hitPointsRecovered,
      updateData: {
        ...hitPointUpdates,
        ...this._getRestResourceRecovery({
          recoverShortRestResources: !longRest,
          recoverLongRestResources: longRest,
        }),
        ...this._getRestSpellRecovery({ recoverSpells: longRest }),
      },
      updateItems: [
        ...hitDiceUpdates,
        ...(await this._getRestItemUsesRecovery({
          recoverLongRestUses: longRest,
          recoverDailyUses: newDay,
          rolls,
        })),
      ],
      longRest,
      newDay,
    };
    result.rolls = rolls;

    /**
     * A hook event that fires after rest result is calculated, but before any updates are performed.
     * @function sds.preRestCompleted
     * @memberof hookEvents
     * @param {Actor5e} actor      The actor that is being rested.
     * @param {RestResult} result  Details on the rest to be completed.
     * @returns {boolean}          Explicitly return `false` to prevent the rest updates from being performed.
     */
    if (Hooks.call("sds.preRestCompleted", this, result) === false)
      return result;

    // Perform updates
    await this.update(result.updateData);
    await this.updateEmbeddedDocuments("Item", result.updateItems);

    // Display a Chat Message summarizing the rest effects
    if (chat) await this._displayRestResultMessage(result, longRest);

    /**
     * A hook event that fires when the rest process is completed for an actor.
     * @function sds.restCompleted
     * @memberof hookEvents
     * @param {Actor5e} actor      The actor that just completed resting.
     * @param {RestResult} result  Details on the rest completed.
     */
    Hooks.callAll("sds.restCompleted", this, result);

    // Return data summarizing the rest effects
    return result;
  }

  /* -------------------------------------------- */

  /**
   * Display a chat message with the result of a rest.
   *
   * @param {RestResult} result         Result of the rest operation.
   * @param {boolean} [longRest=false]  Is this a long rest?
   * @returns {Promise<ChatMessage>}    Chat message that was created.
   * @protected
   */
  async _displayRestResultMessage(result, longRest = false) {
    const { dhd, dhp, newDay } = result;
    const diceRestored = dhd !== 0;
    const healthRestored = dhp !== 0;
    const length = longRest ? "Long" : "Short";

    // Summarize the rest duration
    let restFlavor;
    switch (game.settings.get("sds", "restVariant")) {
      case "normal":
        restFlavor =
          longRest && newDay
            ? "SdS.LongRestOvernight"
            : `SdS.${length}RestNormal`;
        break;
      case "gritty":
        restFlavor =
          !longRest && newDay
            ? "SdS.ShortRestOvernight"
            : `SdS.${length}RestGritty`;
        break;
      case "epic":
        restFlavor = `SdS.${length}RestEpic`;
        break;
    }

    // Determine the chat message to display
    let message;
    if (diceRestored && healthRestored) message = `SdS.${length}RestResult`;
    else if (longRest && !diceRestored && healthRestored)
      message = "SdS.LongRestResultHitPoints";
    else if (longRest && diceRestored && !healthRestored)
      message = "SdS.LongRestResultHitDice";
    else message = `SdS.${length}RestResultShort`;

    // Create a chat message
    let chatData = {
      user: game.user.id,
      speaker: { actor: this, alias: this.name },
      flavor: game.i18n.localize(restFlavor),
      rolls: result.rolls,
      content: game.i18n.format(message, {
        name: this.name,
        dice: longRest ? dhd : -dhd,
        health: dhp,
      }),
    };
    ChatMessage.applyRollMode(chatData, game.settings.get("core", "rollMode"));
    return ChatMessage.create(chatData);
  }

  /* -------------------------------------------- */

  /**
   * Automatically spend hit dice to recover hit points up to a certain threshold.
   * @param {object} [options]
   * @param {number} [options.threshold=3]  A number of missing hit points which would trigger an automatic HD roll.
   * @returns {Promise<number>}             Number of hit dice spent.
   */
  async autoSpendHitDice({ threshold = 3 } = {}) {
    const hp = this.system.attributes.hp;
    const max = hp.max + hp.tempmax;
    let diceRolled = 0;
    while (this.system.attributes.hp.value + threshold <= max) {
      const r = await this.rollHitDie();
      if (r === null) break;
      diceRolled += 1;
    }
    return diceRolled;
  }

  /* -------------------------------------------- */

  /**
   * Recovers actor hit points and eliminates any temp HP.
   * @param {object} [options]
   * @param {boolean} [options.recoverTemp=true]     Reset temp HP to zero.
   * @param {boolean} [options.recoverTempMax=true]  Reset temp max HP to zero.
   * @returns {object}                               Updates to the actor and change in hit points.
   * @protected
   */
  _getRestHitPointRecovery({ recoverTemp = true, recoverTempMax = true } = {}) {
    const hp = this.system.attributes.hp;
    let max = hp.max;
    let updates = {};
    if (recoverTempMax) updates["system.attributes.hp.tempmax"] = 0;
    else max += hp.tempmax;
    updates["system.attributes.hp.value"] = max;
    if (recoverTemp) updates["system.attributes.hp.temp"] = 0;
    return { updates, hitPointsRecovered: max - hp.value };
  }

  /* -------------------------------------------- */

  /**
   * Recovers actor resources.
   * @param {object} [options]
   * @param {boolean} [options.recoverShortRestResources=true]  Recover resources that recharge on a short rest.
   * @param {boolean} [options.recoverLongRestResources=true]   Recover resources that recharge on a long rest.
   * @returns {object}                                          Updates to the actor.
   * @protected
   */
  _getRestResourceRecovery({
    recoverShortRestResources = true,
    recoverLongRestResources = true,
  } = {}) {
    let updates = {};
    for (let [k, r] of Object.entries(this.system.resources)) {
      if (
        Number.isNumeric(r.max) &&
        ((recoverShortRestResources && r.sr) ||
          (recoverLongRestResources && r.lr))
      ) {
        updates[`system.resources.${k}.value`] = Number(r.max);
      }
    }
    return updates;
  }

  /* -------------------------------------------- */

  /**
   * Recovers spell slots and pact slots.
   * @param {object} [options]
   * @param {boolean} [options.recoverPact=true]     Recover all expended pact slots.
   * @param {boolean} [options.recoverSpells=true]   Recover all expended spell slots.
   * @returns {object}                               Updates to the actor.
   * @protected
   */
  _getRestSpellRecovery({ recoverPact = true, recoverSpells = true } = {}) {
    const spells = this.system.spells;
    let updates = {};
    if (recoverPact) {
      const pact = spells.pact;
      updates["system.spells.pact.value"] = pact.override || pact.max;
    }
    if (recoverSpells) {
      for (let [k, v] of Object.entries(spells)) {
        updates[`system.spells.${k}.value`] = Number.isNumeric(v.override)
          ? v.override
          : v.max ?? 0;
      }
    }
    return updates;
  }

  /* -------------------------------------------- */

  /**
   * Recovers class hit dice during a long rest.
   *
   * @param {object} [options]
   * @param {number} [options.maxHitDice]  Maximum number of hit dice to recover.
   * @returns {object}                     Array of item updates and number of hit dice recovered.
   * @protected
   */
  _getRestHitDiceRecovery({ maxHitDice } = {}) {
    // Determine the number of hit dice which may be recovered
    if (maxHitDice === undefined)
      maxHitDice = Math.max(Math.floor(this.system.details.level / 2), 1);

    // Sort classes which can recover HD, assuming players prefer recovering larger HD first.
    const sortedClasses = Object.values(this.classes).sort((a, b) => {
      return (
        (parseInt(b.system.hitDice.slice(1)) || 0) -
        (parseInt(a.system.hitDice.slice(1)) || 0)
      );
    });

    // Update hit dice usage
    let updates = [];
    let hitDiceRecovered = 0;
    for (let item of sortedClasses) {
      const hitDiceUsed = item.system.hitDiceUsed;
      if (hitDiceRecovered < maxHitDice && hitDiceUsed > 0) {
        let delta = Math.min(hitDiceUsed || 0, maxHitDice - hitDiceRecovered);
        hitDiceRecovered += delta;
        updates.push({
          _id: item.id,
          "system.hitDiceUsed": hitDiceUsed - delta,
        });
      }
    }
    return { updates, hitDiceRecovered };
  }

  /* -------------------------------------------- */

  /**
   * Recovers item uses during short or long rests.
   * @param {object} [options]
   * @param {boolean} [options.recoverShortRestUses=true]  Recover uses for items that recharge after a short rest.
   * @param {boolean} [options.recoverLongRestUses=true]   Recover uses for items that recharge after a long rest.
   * @param {boolean} [options.recoverDailyUses=true]      Recover uses for items that recharge on a new day.
   * @param {Roll[]} [options.rolls]                       Rolls that have been performed as part of this rest.
   * @returns {Promise<object[]>}                          Array of item updates.
   * @protected
   */
  async _getRestItemUsesRecovery({
    recoverShortRestUses = true,
    recoverLongRestUses = true,
    recoverDailyUses = true,
    rolls,
  } = {}) {
    let recovery = [];
    if (recoverShortRestUses) recovery.push("sr");
    if (recoverLongRestUses) recovery.push("lr");
    if (recoverDailyUses) recovery.push("day");
    let updates = [];
    for (let item of this.items) {
      const uses = item.system.uses;
      if (recovery.includes(uses?.per)) {
        updates.push({ _id: item.id, "system.uses.value": uses.max });
      }
      if (recoverLongRestUses && item.system.recharge?.value) {
        updates.push({ _id: item.id, "system.recharge.charged": true });
      }

      // Items that roll to gain charges on a new day
      if (recoverDailyUses && uses?.recovery && uses?.per === "charges") {
        const roll = new Roll(uses.recovery, this.getRollData());
        if (
          recoverLongRestUses &&
          game.settings.get("sds", "restVariant") === "gritty"
        ) {
          roll.alter(7, 0, { multiplyNumeric: true });
        }

        let total = 0;
        try {
          total = (await roll.evaluate({ async: true })).total;
        } catch (err) {
          ui.notifications.warn(
            game.i18n.format("SdS.ItemRecoveryFormulaWarning", {
              name: item.name,
              formula: uses.recovery,
            })
          );
        }

        const newValue = Math.clamped(uses.value + total, 0, uses.max);
        if (newValue !== uses.value) {
          const diff = newValue - uses.value;
          const isMax = newValue === uses.max;
          const locKey = `SdS.Item${diff < 0 ? "Loss" : "Recovery"}Roll${
            isMax ? "Max" : ""
          }`;
          updates.push({ _id: item.id, "system.uses.value": newValue });
          rolls.push(roll);
          await roll.toMessage({
            user: game.user.id,
            speaker: { actor: this, alias: this.name },
            flavor: game.i18n.format(locKey, {
              name: item.name,
              count: Math.abs(diff),
            }),
          });
        }
      }
    }
    return updates;
  }

  /* -------------------------------------------- */
  /*  Conversion & Transformation                 */
  /* -------------------------------------------- */

  /**
   * Convert all carried currency to the highest possible denomination using configured conversion rates.
   * See CONFIG.SdS.currencies for configuration.
   * @returns {Promise<Actor5e>}
   */
  convertCurrency() {
    const currency = foundry.utils.deepClone(this.system.currency);
    const currencies = Object.entries(CONFIG.SdS.currencies);
    currencies.sort((a, b) => a[1].conversion - b[1].conversion);

    // Count total converted units of the base currency
    let basis = currencies.reduce((change, [denomination, config]) => {
      if (!config.conversion) return change;
      return change + currency[denomination] / config.conversion;
    }, 0);

    // Convert base units into the highest denomination possible
    for (const [denomination, config] of currencies) {
      if (!config.conversion) continue;
      const amount = Math.floor(basis * config.conversion);
      currency[denomination] = amount;
      basis -= amount / config.conversion;
    }

    // Save the updated currency object
    return this.update({ "system.currency": currency });
  }

  /* -------------------------------------------- */

  /**
   * Options that determine what properties of the original actor are kept and which are replaced with
   * the target actor.
   *
   * @typedef {object} TransformationOptions
   * @property {boolean} [keepPhysical=false]       Keep physical abilities (str, dex, con)
   * @property {boolean} [keepMental=false]         Keep mental abilities (int, wis, cha)
   * @property {boolean} [keepSaves=false]          Keep saving throw proficiencies
   * @property {boolean} [keepSkills=false]         Keep skill proficiencies
   * @property {boolean} [mergeSaves=false]         Take the maximum of the save proficiencies
   * @property {boolean} [mergeSkills=false]        Take the maximum of the skill proficiencies
   * @property {boolean} [keepClass=false]          Keep proficiency bonus
   * @property {boolean} [keepFeats=false]          Keep features
   * @property {boolean} [keepSpells=false]         Keep spells
   * @property {boolean} [keepItems=false]          Keep items
   * @property {boolean} [keepBio=false]            Keep biography
   * @property {boolean} [keepVision=false]         Keep vision
   * @property {boolean} [keepSelf=false]           Keep self
   * @property {boolean} [keepAE=false]             Keep all effects
   * @property {boolean} [keepOriginAE=true]        Keep effects which originate on this actor
   * @property {boolean} [keepOtherOriginAE=true]   Keep effects which originate on another actor
   * @property {boolean} [keepSpellAE=true]         Keep effects which originate from actors spells
   * @property {boolean} [keepFeatAE=true]          Keep effects which originate from actors features
   * @property {boolean} [keepEquipmentAE=true]     Keep effects which originate on actors equipment
   * @property {boolean} [keepClassAE=true]         Keep effects which originate from actors class/subclass
   * @property {boolean} [keepBackgroundAE=true]    Keep effects which originate from actors background
   * @property {boolean} [transformTokens=true]     Transform linked tokens too
   */

  /**
   * Transform this Actor into another one.
   *
   * @param {Actor5e} target                      The target Actor.
   * @param {TransformationOptions} [options={}]  Options that determine how the transformation is performed.
   * @param {boolean} [options.renderSheet=true]  Render the sheet of the transformed actor after the polymorph
   * @returns {Promise<Array<Token>>|null}        Updated token if the transformation was performed.
   */
  async transformInto(
    target,
    {
      keepPhysical = false,
      keepMental = false,
      keepSaves = false,
      keepSkills = false,
      mergeSaves = false,
      mergeSkills = false,
      keepClass = false,
      keepFeats = false,
      keepSpells = false,
      keepItems = false,
      keepBio = false,
      keepVision = false,
      keepSelf = false,
      keepAE = false,
      keepOriginAE = true,
      keepOtherOriginAE = true,
      keepSpellAE = true,
      keepEquipmentAE = true,
      keepFeatAE = true,
      keepClassAE = true,
      keepBackgroundAE = true,
      transformTokens = true,
    } = {},
    { renderSheet = true } = {}
  ) {
    // Ensure the player is allowed to polymorph
    const allowed = game.settings.get("sds", "allowPolymorphing");
    if (!allowed && !game.user.isGM) {
      return ui.notifications.warn(game.i18n.localize("SdS.PolymorphWarn"));
    }

    // Get the original Actor data and the new source data
    const o = this.toObject();
    o.flags.sds = o.flags.sds || {};
    o.flags.sds.transformOptions = { mergeSkills, mergeSaves };
    const source = target.toObject();

    if (keepSelf) {
      o.img = source.img;
      o.name = `${o.name} (${game.i18n.localize("SdS.PolymorphSelf")})`;
    }

    // Prepare new data to merge from the source
    const d = foundry.utils.mergeObject(
      {
        type: o.type, // Remain the same actor type
        name: `${o.name} (${source.name})`, // Append the new shape to your old name
        system: source.system, // Get the systemdata model of your new form
        items: source.items, // Get the items of your new form
        effects: o.effects.concat(source.effects), // Combine active effects from both forms
        img: source.img, // New appearance
        ownership: o.ownership, // Use the original actor permissions
        folder: o.folder, // Be displayed in the same sidebar folder
        flags: o.flags, // Use the original actor flags
        prototypeToken: {
          name: `${o.name} (${source.name})`,
          texture: {},
          sight: {},
          detectionModes: [],
        }, // Set a new empty token
      },
      keepSelf ? o : {}
    ); // Keeps most of original actor

    // Specifically delete some data attributes
    delete d.system.resources; // Don't change your resource pools
    delete d.system.currency; // Don't lose currency
    delete d.system.bonuses; // Don't lose global bonuses

    // Specific additional adjustments
    d.system.details.alignment = o.system.details.alignment; // Don't change alignment
    d.system.attributes.exhaustion = o.system.attributes.exhaustion; // Keep your prior exhaustion level
    d.system.attributes.inspiration = o.system.attributes.inspiration; // Keep inspiration
    d.system.spells = o.system.spells; // Keep spell slots
    d.system.attributes.ac.flat = target.system.attributes.ac.value; // Override AC

    // Token appearance updates
    for (const k of ["width", "height", "alpha", "lockRotation"]) {
      d.prototypeToken[k] = source.prototypeToken[k];
    }
    for (const k of ["offsetX", "offsetY", "scaleX", "scaleY", "src", "tint"]) {
      d.prototypeToken.texture[k] = source.prototypeToken.texture[k];
    }
    for (const k of [
      "bar1",
      "bar2",
      "displayBars",
      "displayName",
      "disposition",
      "rotation",
      "elevation",
    ]) {
      d.prototypeToken[k] = o.prototypeToken[k];
    }

    if (!keepSelf) {
      const sightSource = keepVision ? o.prototypeToken : source.prototypeToken;
      for (const k of [
        "range",
        "angle",
        "visionMode",
        "color",
        "attenuation",
        "brightness",
        "saturation",
        "contrast",
        "enabled",
      ]) {
        d.prototypeToken.sight[k] = sightSource.sight[k];
      }
      d.prototypeToken.detectionModes = sightSource.detectionModes;

      // Transfer ability scores
      const abilities = d.system.abilities;
      for (let k of Object.keys(abilities)) {
        const oa = o.system.abilities[k];
        const prof = abilities[k].proficient;
        if (keepPhysical && ["str", "dex", "con"].includes(k))
          abilities[k] = oa;
        else if (keepMental && ["int", "wis", "cha"].includes(k))
          abilities[k] = oa;
        if (keepSaves) abilities[k].proficient = oa.proficient;
        else if (mergeSaves)
          abilities[k].proficient = Math.max(prof, oa.proficient);
      }

      // Transfer skills
      if (keepSkills) d.system.skills = o.system.skills;
      else if (mergeSkills) {
        for (let [k, s] of Object.entries(d.system.skills)) {
          s.value = Math.max(s.value, o.system.skills[k].value);
        }
      }

      // Keep specific items from the original data
      d.items = d.items.concat(
        o.items.filter((i) => {
          if (["class", "subclass"].includes(i.type)) return keepClass;
          else if (i.type === "feat") return keepFeats;
          else if (i.type === "spell") return keepSpells;
          else return keepItems;
        })
      );

      // Transfer classes for NPCs
      if (!keepClass && d.system.details.cr) {
        const cls = new sds.dataModels.item.ClassData({
          levels: d.system.details.cr,
        });
        d.items.push({
          type: "class",
          name: game.i18n.localize("SdS.PolymorphTmpClass"),
          system: cls.toObject(),
        });
      }

      // Keep biography
      if (keepBio) d.system.details.biography = o.system.details.biography;

      // Keep senses
      if (keepVision) d.system.traits.senses = o.system.traits.senses;

      // Remove active effects
      const oEffects = foundry.utils.deepClone(d.effects);
      const originEffectIds = new Set(
        oEffects
          .filter((effect) => {
            return !effect.origin || effect.origin === this.uuid;
          })
          .map((e) => e._id)
      );
      d.effects = d.effects.filter((e) => {
        if (keepAE) return true;
        const origin =
          e.origin?.startsWith("Actor") || e.origin?.startsWith("Item")
            ? fromUuidSync(e.origin)
            : {};
        const originIsSelf = origin?.parent?.uuid === this.uuid;
        const isOriginEffect = originEffectIds.has(e._id);
        if (isOriginEffect) return keepOriginAE;
        if (!isOriginEffect && !originIsSelf) return keepOtherOriginAE;
        if (origin.type === "spell") return keepSpellAE;
        if (origin.type === "feat") return keepFeatAE;
        if (origin.type === "background") return keepBackgroundAE;
        if (["subclass", "feat"].includes(origin.type)) return keepClassAE;
        if (
          ["equipment", "weapon", "tool", "loot", "backpack"].includes(
            origin.type
          )
        )
          return keepEquipmentAE;
        return true;
      });
    }

    // Set a random image if source is configured that way
    if (source.prototypeToken.randomImg) {
      const images = await target.getTokenImages();
      d.prototypeToken.texture.src =
        images[Math.floor(Math.random() * images.length)];
    }

    // Set new data flags
    if (!this.isPolymorphed || !d.flags.sds.originalActor)
      d.flags.sds.originalActor = this.id;
    d.flags.sds.isPolymorphed = true;

    // Gather previous actor data
    const previousActorIds = this.getFlag("sds", "previousActorIds") || [];
    previousActorIds.push(this._id);
    foundry.utils.setProperty(
      d.flags,
      "sds.previousActorIds",
      previousActorIds
    );

    // Update unlinked Tokens, and grab a copy of any actorData adjustments to re-apply
    if (this.isToken) {
      const tokenData = d.prototypeToken;
      delete d.prototypeToken;
      tokenData.actorData = d;
      setProperty(
        tokenData,
        "flags.sds.previousActorData",
        this.token.toObject().actorData
      );
      await this.sheet?.close();
      const update = await this.token.update(tokenData);
      if (renderSheet) this.sheet?.render(true);
      return update;
    }

    // Close sheet for non-transformed Actor
    await this.sheet?.close();

    /**
     * A hook event that fires just before the actor is transformed.
     * @function sds.transformActor
     * @memberof hookEvents
     * @param {Actor5e} actor                  The original actor before transformation.
     * @param {Actor5e} target                 The target actor into which to transform.
     * @param {object} data                    The data that will be used to create the new transformed actor.
     * @param {TransformationOptions} options  Options that determine how the transformation is performed.
     * @param {object} [options]
     */
    Hooks.callAll(
      "sds.transformActor",
      this,
      target,
      d,
      {
        keepPhysical,
        keepMental,
        keepSaves,
        keepSkills,
        mergeSaves,
        mergeSkills,
        keepClass,
        keepFeats,
        keepSpells,
        keepItems,
        keepBio,
        keepVision,
        keepSelf,
        keepAE,
        keepOriginAE,
        keepOtherOriginAE,
        keepSpellAE,
        keepEquipmentAE,
        keepFeatAE,
        keepClassAE,
        keepBackgroundAE,
        transformTokens,
      },
      { renderSheet }
    );

    // Create new Actor with transformed data
    const newActor = await this.constructor.create(d, { renderSheet: true });

    // Update placed Token instances
    if (!transformTokens) return;
    const tokens = this.getActiveTokens(true);
    const updates = tokens.map((t) => {
      const newTokenData = foundry.utils.deepClone(d.prototypeToken);
      newTokenData._id = t.id;
      newTokenData.actorId = newActor.id;
      newTokenData.actorLink = true;

      const dOriginalActor = foundry.utils.getProperty(
        d,
        "flags.sds.originalActor"
      );
      foundry.utils.setProperty(
        newTokenData,
        "flags.sds.originalActor",
        dOriginalActor
      );
      foundry.utils.setProperty(newTokenData, "flags.sds.isPolymorphed", true);
      return newTokenData;
    });
    return canvas.scene?.updateEmbeddedDocuments("Token", updates);
  }

  /* -------------------------------------------- */

  /**
   * If this actor was transformed with transformTokens enabled, then its
   * active tokens need to be returned to their original state. If not, then
   * we can safely just delete this actor.
   * @param {object} [options]
   * @param {boolean} [options.renderSheet=true]  Render Sheet after revert the transformation.
   * @returns {Promise<Actor>|null}  Original actor if it was reverted.
   */
  async revertOriginalForm({ renderSheet = true } = {}) {
    if (!this.isPolymorphed) return;
    if (!this.isOwner)
      return ui.notifications.warn(
        game.i18n.localize("SdS.PolymorphRevertWarn")
      );

    /**
     * A hook event that fires just before the actor is reverted to original form.
     * @function sds.revertOriginalForm
     * @memberof hookEvents
     * @param {Actor} this                 The original actor before transformation.
     * @param {object} [options]
     */
    Hooks.callAll("sds.revertOriginalForm", this, { renderSheet });
    const previousActorIds = this.getFlag("sds", "previousActorIds") ?? [];
    const isOriginalActor = !previousActorIds.length;
    const isRendered = this.sheet.rendered;

    // Obtain a reference to the original actor
    const original = game.actors.get(this.getFlag("sds", "originalActor"));

    // If we are reverting an unlinked token, grab the previous actorData, and create a new token
    if (this.isToken) {
      const baseActor = original
        ? original
        : game.actors.get(this.token.actorId);
      if (!baseActor) {
        ui.notifications.warn(
          game.i18n.format("SdS.PolymorphRevertNoOriginalActorWarn", {
            reference: this.getFlag("sds", "originalActor"),
          })
        );
        return;
      }
      const prototypeTokenData = await baseActor.getTokenDocument();
      const actorData = this.token.getFlag("sds", "previousActorData");
      const tokenUpdate = this.token.toObject();
      tokenUpdate.actorData = actorData ? actorData : {};

      for (const k of ["width", "height", "alpha", "lockRotation", "name"]) {
        tokenUpdate[k] = prototypeTokenData[k];
      }
      for (const k of [
        "offsetX",
        "offsetY",
        "scaleX",
        "scaleY",
        "src",
        "tint",
      ]) {
        tokenUpdate.texture[k] = prototypeTokenData.texture[k];
      }
      tokenUpdate.sight = prototypeTokenData.sight;
      tokenUpdate.detectionModes = prototypeTokenData.detectionModes;

      await this.sheet.close();
      await canvas.scene?.deleteEmbeddedDocuments("Token", [this.token._id]);
      const token = await TokenDocument.implementation.create(tokenUpdate, {
        parent: canvas.scene,
        keepId: true,
        render: true,
      });
      if (isOriginalActor) {
        await this.unsetFlag("sds", "isPolymorphed");
        await this.unsetFlag("sds", "previousActorIds");
        await this.token.unsetFlag("sds", "previousActorData");
      }
      if (isRendered && renderSheet) token.actor?.sheet?.render(true);
      return token;
    }

    if (!original) {
      ui.notifications.warn(
        game.i18n.format("SdS.PolymorphRevertNoOriginalActorWarn", {
          reference: this.getFlag("sds", "originalActor"),
        })
      );
      return;
    }

    // Get the Tokens which represent this actor
    if (canvas.ready) {
      const tokens = this.getActiveTokens(true);
      const tokenData = await original.getTokenDocument();
      const tokenUpdates = tokens.map((t) => {
        const update = duplicate(tokenData);
        update._id = t.id;
        delete update.x;
        delete update.y;
        return update;
      });
      await canvas.scene.updateEmbeddedDocuments("Token", tokenUpdates);
    }
    if (isOriginalActor) {
      await this.unsetFlag("sds", "isPolymorphed");
      await this.unsetFlag("sds", "previousActorIds");
    }

    // Delete the polymorphed version(s) of the actor, if possible
    if (game.user.isGM) {
      const idsToDelete = previousActorIds
        .filter(
          (id) =>
            id !== original.id && // Is not original Actor Id
            game.actors?.get(id) // Actor still exists
        )
        .concat([this.id]); // Add this id

      await Actor.implementation.deleteDocuments(idsToDelete);
    } else if (isRendered) {
      this.sheet?.close();
    }
    if (isRendered && renderSheet) original.sheet?.render(isRendered);
    return original;
  }

  /* -------------------------------------------- */

  /**
   * Add additional system-specific sidebar directory context menu options for Actor documents
   * @param {jQuery} html         The sidebar HTML
   * @param {Array} entryOptions  The default array of context menu options
   */
  static addDirectoryContextOptions(html, entryOptions) {
    entryOptions.push({
      name: "SdS.PolymorphRestoreTransformation",
      icon: '<i class="fas fa-backward"></i>',
      callback: (li) => {
        const actor = game.actors.get(li.data("documentId"));
        return actor.revertOriginalForm();
      },
      condition: (li) => {
        const allowed = game.settings.get("sds", "allowPolymorphing");
        if (!allowed && !game.user.isGM) return false;
        const actor = game.actors.get(li.data("documentId"));
        return actor && actor.isPolymorphed;
      },
    });
  }

  /* -------------------------------------------- */

  /**
   * Format a type object into a string.
   * @param {object} typeData          The type data to convert to a string.
   * @returns {string}
   */
  static formatCreatureType(typeData) {
    if (typeof typeData === "string") return typeData; // Backwards compatibility
    let localizedType;
    if (typeData.value === "custom") {
      localizedType = typeData.custom;
    } else {
      let code = CONFIG.SdS.creatureTypes[typeData.value];
      localizedType = game.i18n.localize(typeData.swarm ? `${code}Pl` : code);
    }
    let type = localizedType;
    if (typeData.swarm) {
      type = game.i18n.format("SdS.CreatureSwarmPhrase", {
        size: game.i18n.localize(CONFIG.SdS.actorSizes[typeData.swarm]),
        type: localizedType,
      });
    }
    if (typeData.subtype) type = `${type} (${typeData.subtype})`;
    return type;
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */

  /** @inheritdoc */
  _onUpdate(data, options, userId) {
    super._onUpdate(data, options, userId);
    this._displayScrollingDamage(options.dhp);
  }

  /* -------------------------------------------- */

  /**
   * Display changes to health as scrolling combat text.
   * Adapt the font size relative to the Actor's HP total to emphasize more significant blows.
   * @param {number} dhp      The change in hit points that was applied
   * @private
   */
  _displayScrollingDamage(dhp) {
    if (!dhp) return;
    dhp = Number(dhp);
    const tokens = this.isToken
      ? [this.token?.object]
      : this.getActiveTokens(true);
    for (const t of tokens) {
      const pct = Math.clamped(
        Math.abs(dhp) / this.system.attributes.hp.max,
        0,
        1
      );
      canvas.interface.createScrollingText(t.center, dhp.signedString(), {
        anchor: CONST.TEXT_ANCHOR_POINTS.TOP,
        fontSize: 16 + 32 * pct, // Range between [16, 48]
        fill: CONFIG.SdS.tokenHPColors[dhp < 0 ? "damage" : "healing"],
        stroke: 0x000000,
        strokeThickness: 4,
        jitter: 0.25,
      });
    }
  }

  /* -------------------------------------------- */
  /*  DEPRECATED METHODS                          */
  /* -------------------------------------------- */

  /**
   * Determine a character's AC value from their equipped armor and shield.
   * @returns {object}
   * @private
   * @deprecated since sds 2.0, targeted for removal in 2.2
   */
  _computeArmorClass() {
    foundry.utils.logCompatibilityWarning(
      "Actor5e#_computeArmorClass has been renamed Actor5e#_prepareArmorClass.",
      { since: "SdS 2.0", until: "SdS 2.2" }
    );
    this._prepareArmorClass();
    return this.system.attributes.ac;
  }

  /* -------------------------------------------- */

  /**
   * Compute the level and percentage of encumbrance for an Actor.
   * @returns {object}  An object describing the character's encumbrance level
   * @private
   * @deprecated since sds 2.0, targeted for removal in 2.2
   */
  _computeEncumbrance() {
    foundry.utils.logCompatibilityWarning(
      "Actor5e#_computeEncumbrance has been renamed Actor5e#_prepareEncumbrance.",
      { since: "SdS 2.0", until: "SdS 2.2" }
    );
    this._prepareEncumbrance();
    return this.system.attributes.encumbrance;
  }

  /* -------------------------------------------- */

  /**
   * Calculate the initiative bonus to display on a character sheet.
   * @private
   * @deprecated since sds 2.0, targeted for removal in 2.2
   */
  _computeInitiativeModifier() {
    foundry.utils.logCompatibilityWarning(
      "Actor5e#_computeInitiativeModifier has been renamed Actor5e#_prepareInitiative.",
      { since: "SdS 2.0", until: "SdS 2.2" }
    );
    this._prepareInitiative();
  }

  /* -------------------------------------------- */

  /**
   * Prepare data related to the spell-casting capabilities of the Actor.
   * Mutates the value of the system.spells object.
   * @private
   * @deprecated since sds 2.0, targeted for removal in 2.2
   */
  _computeSpellcastingProgression() {
    foundry.utils.logCompatibilityWarning(
      "Actor5e#_computeSpellcastingProgression has been renamed Actor5e#_prepareSpellcasting.",
      { since: "SdS 2.0", until: "SdS 2.2" }
    );
    this._prepareSpellcasting();
  }

  /* -------------------------------------------- */

  /**
   * Convert a bonus value to a simple integer for displaying on the sheet.
   * @param {number|string|null} bonus  Actor's bonus value.
   * @param {object} data               Actor data to use for replacing @ strings.
   * @returns {number}                  Simplified bonus as an integer.
   * @protected
   * @deprecated since sds 2.0, targeted for removal in 2.2
   */
  _simplifyBonus(bonus, data) {
    foundry.utils.logCompatibilityWarning(
      "Actor#_simplifyBonus has been made a utility function and can be accessed at sds.utils.simplifyBonus.",
      { since: "SdS 2.0", until: "SdS 2.2" }
    );
    return simplifyBonus(bonus, data);
  }
}

/**
 * A specialized form used to select from a checklist of attributes, traits, or properties
 */
class ActorTypeConfig extends FormApplication {
  /** @inheritDoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["sds", "actor-type", "trait-selector"],
      template: "systems/sds/templates/apps/actor-type.hbs",
      width: 280,
      height: "auto",
      choices: {},
      allowCustom: true,
      minimum: 0,
      maximum: null,
    });
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  get title() {
    return `${game.i18n.localize("SdS.CreatureTypeTitle")}: ${
      this.object.name
    }`;
  }

  /* -------------------------------------------- */

  /** @override */
  get id() {
    return `actor-type-${this.object.id}`;
  }

  /* -------------------------------------------- */

  /** @override */
  getData(options = {}) {
    // Get current value or new default
    let attr = foundry.utils.getProperty(this.object.system, "details.type");
    if (foundry.utils.getType(attr) !== "Object")
      attr = {
        value: attr in CONFIG.SdS.creatureTypes ? attr : "humanoid",
        subtype: "",
        swarm: "",
        custom: "",
      };

    // Populate choices
    const types = {};
    for (let [k, v] of Object.entries(CONFIG.SdS.creatureTypes)) {
      types[k] = {
        label: game.i18n.localize(v),
        chosen: attr.value === k,
      };
    }

    // Return data for rendering
    return {
      types: types,
      custom: {
        value: attr.custom,
        label: game.i18n.localize("SdS.CreatureTypeSelectorCustom"),
        chosen: attr.value === "custom",
      },
      subtype: attr.subtype,
      swarm: attr.swarm,
      sizes: Array.from(Object.entries(CONFIG.SdS.actorSizes))
        .reverse()
        .reduce((obj, e) => {
          obj[e[0]] = e[1];
          return obj;
        }, {}),
      preview: Actor5e.formatCreatureType(attr) || "–",
    };
  }

  /* -------------------------------------------- */

  /** @override */
  async _updateObject(event, formData) {
    const typeObject = foundry.utils.expandObject(formData);
    return this.object.update({ "system.details.type": typeObject });
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */

  /** @inheritdoc */
  activateListeners(html) {
    super.activateListeners(html);
    html
      .find("input[name='custom']")
      .focusin(this._onCustomFieldFocused.bind(this));
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _onChangeInput(event) {
    super._onChangeInput(event);
    const typeObject = foundry.utils.expandObject(this._getSubmitData());
    this.form.preview.value = Actor5e.formatCreatureType(typeObject) || "—";
  }

  /* -------------------------------------------- */

  /**
   * Select the custom radio button when the custom text field is focused.
   * @param {FocusEvent} event      The original focusin event
   * @private
   */
  _onCustomFieldFocused(event) {
    this.form.querySelector(
      "input[name='value'][value='custom']"
    ).checked = true;
    this._onChangeInput(event);
  }
}

/**
 * Dialog to confirm the deletion of an embedded item with advancement or decreasing a class level.
 */
class AdvancementConfirmationDialog extends Dialog {
  /** @inheritdoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      template:
        "systems/sds/templates/advancement/advancement-confirmation-dialog.hbs",
      jQuery: false,
    });
  }

  /* -------------------------------------------- */

  /**
   * A helper function that displays the dialog prompting for an item deletion.
   * @param {Item5e} item  Item to be deleted.
   * @returns {Promise<boolean|null>}  Resolves with whether advancements should be unapplied. Rejects with null.
   */
  static forDelete(item) {
    return this.createDialog(
      item,
      game.i18n.localize("SdS.AdvancementDeleteConfirmationTitle"),
      game.i18n.localize("SdS.AdvancementDeleteConfirmationMessage"),
      {
        icon: '<i class="fas fa-trash"></i>',
        label: game.i18n.localize("Delete"),
      }
    );
  }

  /* -------------------------------------------- */

  /**
   * A helper function that displays the dialog prompting for leveling down.
   * @param {Item5e} item  The class whose level is being changed.
   * @returns {Promise<boolean|null>}  Resolves with whether advancements should be unapplied. Rejects with null.
   */
  static forLevelDown(item) {
    return this.createDialog(
      item,
      game.i18n.localize("SdS.AdvancementLevelDownConfirmationTitle"),
      game.i18n.localize("SdS.AdvancementLevelDownConfirmationMessage"),
      {
        icon: '<i class="fas fa-sort-numeric-down-alt"></i>',
        label: game.i18n.localize("SdS.LevelActionDecrease"),
      }
    );
  }

  /* -------------------------------------------- */

  /**
   * A helper constructor function which displays the confirmation dialog.
   * @param {Item5e} item              Item to be changed.
   * @param {string} title             Localized dialog title.
   * @param {string} message           Localized dialog message.
   * @param {object} continueButton    Object containing label and icon for the action button.
   * @returns {Promise<boolean|null>}  Resolves with whether advancements should be unapplied. Rejects with null.
   */
  static createDialog(item, title, message, continueButton) {
    return new Promise((resolve, reject) => {
      const dialog = new this({
        title: `${title}: ${item.name}`,
        content: message,
        buttons: {
          continue: foundry.utils.mergeObject(continueButton, {
            callback: (html) => {
              const checkbox = html.querySelector(
                'input[name="apply-advancement"]'
              );
              resolve(checkbox.checked);
            },
          }),
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize("Cancel"),
            callback: (html) => reject(null),
          },
        },
        default: "continue",
        close: () => reject(null),
      });
      dialog.render(true);
    });
  }
}

/**
 * Internal type used to manage each step within the advancement process.
 *
 * @typedef {object} AdvancementStep
 * @property {string} type                Step type from "forward", "reverse", "restore", or "delete".
 * @property {AdvancementFlow} [flow]     Flow object for the advancement being applied by this step.
 * @property {Item5e} [item]              For "delete" steps only, the item to be removed.
 * @property {object} [class]             Contains data on class if step was triggered by class level change.
 * @property {Item5e} [class.item]        Class item that caused this advancement step.
 * @property {number} [class.level]       Level the class should be during this step.
 * @property {boolean} [automatic=false]  Should the manager attempt to apply this step without user interaction?
 */

/**
 * Application for controlling the advancement workflow and displaying the interface.
 *
 * @param {Actor5e} actor        Actor on which this advancement is being performed.
 * @param {object} [options={}]  Additional application options.
 */
class AdvancementManager extends Application {
  constructor(actor, options = {}) {
    super(options);

    /**
     * The original actor to which changes will be applied when the process is complete.
     * @type {Actor5e}
     */
    this.actor = actor;

    /**
     * A clone of the original actor to which the changes can be applied during the advancement process.
     * @type {Actor5e}
     */
    this.clone = actor.clone();

    /**
     * Individual steps that will be applied in order.
     * @type {object}
     */
    this.steps = [];

    /**
     * Step being currently displayed.
     * @type {number|null}
     * @private
     */
    this._stepIndex = null;

    /**
     * Is the prompt currently advancing through un-rendered steps?
     * @type {boolean}
     * @private
     */
    this._advancing = false;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["sds", "advancement", "flow"],
      template: "systems/sds/templates/advancement/advancement-manager.hbs",
      width: 460,
      height: "auto",
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  get title() {
    const visibleSteps = this.steps.filter((s) => !s.automatic);
    const visibleIndex = visibleSteps.indexOf(this.step);
    const step =
      visibleIndex < 0
        ? ""
        : game.i18n.format("SdS.AdvancementManagerSteps", {
            current: visibleIndex + 1,
            total: visibleSteps.length,
          });
    return `${game.i18n.localize("SdS.AdvancementManagerTitle")} ${step}`;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  get id() {
    return `actor-${this.actor.id}-advancement`;
  }

  /* -------------------------------------------- */

  /**
   * Get the step that is currently in progress.
   * @type {object|null}
   */
  get step() {
    return this.steps[this._stepIndex] ?? null;
  }

  /* -------------------------------------------- */

  /**
   * Get the step before the current one.
   * @type {object|null}
   */
  get previousStep() {
    return this.steps[this._stepIndex - 1] ?? null;
  }

  /* -------------------------------------------- */

  /**
   * Get the step after the current one.
   * @type {object|null}
   */
  get nextStep() {
    const nextIndex = this._stepIndex === null ? 0 : this._stepIndex + 1;
    return this.steps[nextIndex] ?? null;
  }

  /* -------------------------------------------- */
  /*  Factory Methods                             */
  /* -------------------------------------------- */

  /**
   * Construct a manager for a newly added advancement from drag-drop.
   * @param {Actor5e} actor               Actor from which the advancement should be updated.
   * @param {string} itemId               ID of the item to which the advancements are being dropped.
   * @param {Advancement[]} advancements  Dropped advancements to add.
   * @param {object} options              Rendering options passed to the application.
   * @returns {AdvancementManager}  Prepared manager. Steps count can be used to determine if advancements are needed.
   */
  static forNewAdvancement(actor, itemId, advancements, options) {
    const manager = new this(actor, options);
    const clonedItem = manager.clone.items.get(itemId);
    if (!clonedItem || !advancements.length) return manager;

    const currentLevel = this.currentLevel(clonedItem, manager.clone);
    const minimumLevel = advancements.reduce(
      (min, a) => Math.min(a.levels[0] ?? Infinity, min),
      Infinity
    );
    if (minimumLevel > currentLevel) return manager;

    const oldFlows = Array.fromRange(currentLevel + 1)
      .slice(minimumLevel)
      .flatMap((l) => this.flowsForLevel(clonedItem, l));

    // Revert advancements through minimum level
    oldFlows
      .reverse()
      .forEach((flow) =>
        manager.steps.push({ type: "reverse", flow, automatic: true })
      );

    // Add new advancements
    const advancementArray = clonedItem.toObject().system.advancement;
    advancementArray.push(
      ...advancements.map((a) => {
        const obj = a.toObject();
        if (obj.constructor.dataModels?.value)
          a.value = new a.constructor.metadata.dataModels.value().toObject();
        else
          obj.value = foundry.utils.deepClone(
            a.constructor.metadata.defaults?.value ?? {}
          );
        return obj;
      })
    );
    clonedItem.updateSource({ "system.advancement": advancementArray });

    const newFlows = Array.fromRange(currentLevel + 1)
      .slice(minimumLevel)
      .flatMap((l) => this.flowsForLevel(clonedItem, l));

    // Restore existing advancements and apply new advancements
    newFlows.forEach((flow) => {
      const matchingFlow = oldFlows.find(
        (f) =>
          f.advancement.id === flow.advancement.id && f.level === flow.level
      );
      if (matchingFlow)
        manager.steps.push({
          type: "restore",
          flow: matchingFlow,
          automatic: true,
        });
      else manager.steps.push({ type: "forward", flow });
    });

    return manager;
  }

  /* -------------------------------------------- */

  /**
   * Construct a manager for a newly added item.
   * @param {Actor5e} actor         Actor to which the item is being added.
   * @param {object} itemData       Data for the item being added.
   * @param {object} options        Rendering options passed to the application.
   * @returns {AdvancementManager}  Prepared manager. Steps count can be used to determine if advancements are needed.
   */
  static forNewItem(actor, itemData, options = {}) {
    const manager = new this(actor, options);

    // Prepare data for adding to clone
    const dataClone = foundry.utils.deepClone(itemData);
    dataClone._id = foundry.utils.randomID();
    if (itemData.type === "class") {
      dataClone.system.levels = 0;
      if (!manager.clone.system.details.originalClass) {
        manager.clone.updateSource({
          "system.details.originalClass": dataClone._id,
        });
      }
    }

    // Add item to clone & get new instance from clone
    manager.clone.updateSource({ items: [dataClone] });
    const clonedItem = manager.clone.items.get(dataClone._id);

    // For class items, prepare level change data
    if (itemData.type === "class") {
      return manager.createLevelChangeSteps(
        clonedItem,
        itemData.system?.levels ?? 1
      );
    }

    // All other items, just create some flows up to current character level (or class level for subclasses)
    let targetLevel = manager.clone.system.details.level;
    if (clonedItem.type === "subclass")
      targetLevel = clonedItem.class?.system.levels ?? 0;
    Array.fromRange(targetLevel + 1)
      .flatMap((l) => this.flowsForLevel(clonedItem, l))
      .forEach((flow) => manager.steps.push({ type: "forward", flow }));

    return manager;
  }

  /* -------------------------------------------- */

  /**
   * Construct a manager for modifying choices on an item at a specific level.
   * @param {Actor5e} actor         Actor from which the choices should be modified.
   * @param {object} itemId         ID of the item whose choices are to be changed.
   * @param {number} level          Level at which the choices are being changed.
   * @param {object} options        Rendering options passed to the application.
   * @returns {AdvancementManager}  Prepared manager. Steps count can be used to determine if advancements are needed.
   */
  static forModifyChoices(actor, itemId, level, options) {
    const manager = new this(actor, options);
    const clonedItem = manager.clone.items.get(itemId);
    if (!clonedItem) return manager;

    const flows = Array.fromRange(
      this.currentLevel(clonedItem, manager.clone) + 1
    )
      .slice(level)
      .flatMap((l) => this.flowsForLevel(clonedItem, l));

    // Revert advancements through changed level
    flows
      .reverse()
      .forEach((flow) =>
        manager.steps.push({ type: "reverse", flow, automatic: true })
      );

    // Create forward advancements for level being changed
    flows
      .reverse()
      .filter((f) => f.level === level)
      .forEach((flow) => manager.steps.push({ type: "forward", flow }));

    // Create restore advancements for other levels
    flows
      .filter((f) => f.level > level)
      .forEach((flow) =>
        manager.steps.push({ type: "restore", flow, automatic: true })
      );

    return manager;
  }

  /* -------------------------------------------- */

  /**
   * Construct a manager for an advancement that needs to be deleted.
   * @param {Actor5e} actor         Actor from which the advancement should be unapplied.
   * @param {string} itemId         ID of the item from which the advancement should be deleted.
   * @param {string} advancementId  ID of the advancement to delete.
   * @param {object} options        Rendering options passed to the application.
   * @returns {AdvancementManager}  Prepared manager. Steps count can be used to determine if advancements are needed.
   */
  static forDeletedAdvancement(actor, itemId, advancementId, options) {
    const manager = new this(actor, options);
    const clonedItem = manager.clone.items.get(itemId);
    const advancement = clonedItem?.advancement.byId[advancementId];
    if (!advancement) return manager;

    const minimumLevel = advancement.levels[0];
    const currentLevel = this.currentLevel(clonedItem, manager.clone);

    // If minimum level is greater than current level, no changes to remove
    if (minimumLevel > currentLevel || !advancement.appliesToClass)
      return manager;

    advancement.levels
      .reverse()
      .filter((l) => l <= currentLevel)
      .map(
        (l) =>
          new advancement.constructor.metadata.apps.flow(
            clonedItem,
            advancementId,
            l
          )
      )
      .forEach((flow) =>
        manager.steps.push({ type: "reverse", flow, automatic: true })
      );

    if (manager.steps.length)
      manager.steps.push({ type: "delete", advancement, automatic: true });

    return manager;
  }

  /* -------------------------------------------- */

  /**
   * Construct a manager for an item that needs to be deleted.
   * @param {Actor5e} actor         Actor from which the item should be deleted.
   * @param {string} itemId         ID of the item to be deleted.
   * @param {object} options        Rendering options passed to the application.
   * @returns {AdvancementManager}  Prepared manager. Steps count can be used to determine if advancements are needed.
   */
  static forDeletedItem(actor, itemId, options) {
    const manager = new this(actor, options);
    const clonedItem = manager.clone.items.get(itemId);
    if (!clonedItem) return manager;

    // For class items, prepare level change data
    if (clonedItem.type === "class") {
      return manager.createLevelChangeSteps(
        clonedItem,
        clonedItem.system.levels * -1
      );
    }

    // All other items, just create some flows down from current character level
    Array.fromRange(manager.clone.system.details.level + 1)
      .flatMap((l) => this.flowsForLevel(clonedItem, l))
      .reverse()
      .forEach((flow) =>
        manager.steps.push({ type: "reverse", flow, automatic: true })
      );

    // Add a final step to remove the item only if there are advancements to apply
    if (manager.steps.length)
      manager.steps.push({ type: "delete", item: clonedItem, automatic: true });
    return manager;
  }

  /* -------------------------------------------- */

  /**
   * Construct a manager for a change in a class's levels.
   * @param {Actor5e} actor         Actor whose level has changed.
   * @param {string} classId        ID of the class being changed.
   * @param {number} levelDelta     Levels by which to increase or decrease the class.
   * @param {object} options        Rendering options passed to the application.
   * @returns {AdvancementManager}  Prepared manager. Steps count can be used to determine if advancements are needed.
   */
  static forLevelChange(actor, classId, levelDelta, options = {}) {
    const manager = new this(actor, options);
    const clonedItem = manager.clone.items.get(classId);
    if (!clonedItem) return manager;
    return manager.createLevelChangeSteps(clonedItem, levelDelta);
  }

  /* -------------------------------------------- */

  /**
   * Create steps based on the provided level change data.
   * @param {string} classItem      Class being changed.
   * @param {number} levelDelta     Levels by which to increase or decrease the class.
   * @returns {AdvancementManager}  Manager with new steps.
   * @private
   */
  createLevelChangeSteps(classItem, levelDelta) {
    const pushSteps = (flows, data) =>
      this.steps.push(...flows.map((flow) => ({ flow, ...data })));
    const getItemFlows = (characterLevel) =>
      this.clone.items.contents.flatMap((i) => {
        if (["class", "subclass"].includes(i.type)) return [];
        return this.constructor.flowsForLevel(i, characterLevel);
      });

    // Level increased
    for (let offset = 1; offset <= levelDelta; offset++) {
      const classLevel = classItem.system.levels + offset;
      const characterLevel = this.actor.system.details.level + offset;
      const stepData = {
        type: "forward",
        class: { item: classItem, level: classLevel },
      };
      pushSteps(
        this.constructor.flowsForLevel(classItem, classLevel),
        stepData
      );
      pushSteps(
        this.constructor.flowsForLevel(classItem.subclass, classLevel),
        stepData
      );
      pushSteps(getItemFlows(characterLevel), stepData);
    }

    // Level decreased
    for (let offset = 0; offset > levelDelta; offset--) {
      const classLevel = classItem.system.levels + offset;
      const characterLevel = this.actor.system.details.level + offset;
      const stepData = {
        type: "reverse",
        class: { item: classItem, level: classLevel },
        automatic: true,
      };
      pushSteps(getItemFlows(characterLevel).reverse(), stepData);
      pushSteps(
        this.constructor
          .flowsForLevel(classItem.subclass, classLevel)
          .reverse(),
        stepData
      );
      pushSteps(
        this.constructor.flowsForLevel(classItem, classLevel).reverse(),
        stepData
      );
      if (classLevel === 1)
        this.steps.push({ type: "delete", item: classItem, automatic: true });
    }

    // Ensure the class level ends up at the appropriate point
    this.steps.push({
      type: "forward",
      automatic: true,
      class: {
        item: classItem,
        level: (classItem.system.levels += levelDelta),
      },
    });

    return this;
  }

  /* -------------------------------------------- */

  /**
   * Creates advancement flows for all advancements at a specific level.
   * @param {Item5e} item          Item that has advancement.
   * @param {number} level         Level in question.
   * @returns {AdvancementFlow[]}  Created flow applications.
   * @protected
   */
  static flowsForLevel(item, level) {
    return (item?.advancement.byLevel[level] ?? [])
      .filter((a) => a.appliesToClass)
      .map((a) => new a.constructor.metadata.apps.flow(item, a.id, level));
  }

  /* -------------------------------------------- */

  /**
   * Determine the proper working level either from the provided item or from the cloned actor.
   * @param {Item5e} item    Item being advanced. If class or subclass, its level will be used.
   * @param {Actor5e} actor  Actor being advanced.
   * @returns {number}       Working level.
   */
  static currentLevel(item, actor) {
    return (
      item.system.levels ??
      item.class?.system.levels ??
      actor.system.details.level
    );
  }

  /* -------------------------------------------- */
  /*  Form Rendering                              */
  /* -------------------------------------------- */

  /** @inheritdoc */
  getData() {
    if (!this.step) return {};

    // Prepare information for subheading
    const item = this.step.flow.item;
    let level = this.step.flow.level;
    if (this.step.class && ["class", "subclass"].includes(item.type))
      level = this.step.class.level;

    const visibleSteps = this.steps.filter((s) => !s.automatic);
    const visibleIndex = visibleSteps.indexOf(this.step);

    return {
      actor: this.clone,
      flowId: this.step.flow.id,
      header: item.name,
      subheader: level
        ? game.i18n.format("SdS.AdvancementLevelHeader", { level })
        : "",
      steps: {
        current: visibleIndex + 1,
        total: visibleSteps.length,
        hasPrevious: visibleIndex > 0,
        hasNext: visibleIndex < visibleSteps.length - 1,
      },
    };
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  render(...args) {
    if (this.steps.length && this._stepIndex === null) this._stepIndex = 0;

    // Ensure the level on the class item matches the specified level
    if (this.step?.class) {
      let level = this.step.class.level;
      if (this.step.type === "reverse") level -= 1;
      this.step.class.item.updateSource({ "system.levels": level });
      this.clone.reset();
    }

    /**
     * A hook event that fires when an AdvancementManager is about to be processed.
     * @function sds.preAdvancementManagerRender
     * @memberof hookEvents
     * @param {AdvancementManager} advancementManager The advancement manager about to be rendered
     */
    const allowed = Hooks.call("sds.preAdvancementManagerRender", this);

    // Abort if not allowed
    if (allowed === false) return this;

    if (this.step?.automatic) {
      if (this._advancing) return this;
      this._forward();
      return this;
    }

    return super.render(...args);
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async _render(force, options) {
    await super._render(force, options);
    if (this._state !== Application.RENDER_STATES.RENDERED || !this.step)
      return;

    // Render the step
    this.step.flow._element = null;
    await this.step.flow._render(force, options);
    this.setPosition();
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  activateListeners(html) {
    super.activateListeners(html);
    html.find("button[data-action]").click((event) => {
      const buttons = html.find("button");
      buttons.attr("disabled", true);
      html.find(".error").removeClass("error");
      try {
        switch (event.currentTarget.dataset.action) {
          case "restart":
            if (!this.previousStep) return;
            return this._restart(event);
          case "previous":
            if (!this.previousStep) return;
            return this._backward(event);
          case "next":
          case "complete":
            return this._forward(event);
        }
      } finally {
        buttons.attr("disabled", false);
      }
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async close(options = {}) {
    if (!options.skipConfirmation) {
      return new Dialog({
        title: `${game.i18n.localize("SdS.AdvancementManagerCloseTitle")}: ${
          this.actor.name
        }`,
        content: game.i18n.localize("SdS.AdvancementManagerCloseMessage"),
        buttons: {
          close: {
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize("SdS.AdvancementManagerCloseButtonStop"),
            callback: () => super.close(options),
          },
          continue: {
            icon: '<i class="fas fa-chevron-right"></i>',
            label: game.i18n.localize(
              "SdS.AdvancementManagerCloseButtonContinue"
            ),
          },
        },
        default: "close",
      }).render(true);
    }
    await super.close(options);
  }

  /* -------------------------------------------- */
  /*  Process                                     */
  /* -------------------------------------------- */

  /**
   * Advance through the steps until one requiring user interaction is encountered.
   * @param {Event} [event]  Triggering click event if one occurred.
   * @returns {Promise}
   * @private
   */
  async _forward(event) {
    this._advancing = true;
    try {
      do {
        const flow = this.step.flow;

        // Apply changes based on step type
        if (this.step.type === "delete" && this.step.item)
          this.clone.items.delete(this.step.item.id);
        else if (this.step.type === "delete" && this.step.advancement) {
          this.step.advancement.item.deleteAdvancement(
            this.step.advancement.id,
            { source: true }
          );
        } else if (this.step.type === "restore")
          await flow.advancement.restore(flow.level, flow.retainedData);
        else if (this.step.type === "reverse")
          flow.retainedData = await flow.advancement.reverse(flow.level);
        else if (flow) await flow._updateObject(event, flow._getSubmitData());

        this._stepIndex++;

        // Ensure the level on the class item matches the specified level
        if (this.step?.class) {
          let level = this.step.class.level;
          if (this.step.type === "reverse") level -= 1;
          this.step.class.item.updateSource({ "system.levels": level });
        }
        this.clone.reset();
      } while (this.step?.automatic);
    } catch (error) {
      if (!(error instanceof Advancement$1.ERROR)) throw error;
      ui.notifications.error(error.message);
      this.step.automatic = false;
      if (this.step.type === "restore") this.step.type = "forward";
    } finally {
      this._advancing = false;
    }

    if (this.step) this.render(true);
    else this._complete();
  }

  /* -------------------------------------------- */

  /**
   * Reverse through the steps until one requiring user interaction is encountered.
   * @param {Event} [event]                  Triggering click event if one occurred.
   * @param {object} [options]               Additional options to configure behavior.
   * @param {boolean} [options.render=true]  Whether to render the Application after the step has been reversed. Used
   *                                         by the restart workflow.
   * @returns {Promise}
   * @private
   */
  async _backward(event, { render = true } = {}) {
    this._advancing = true;
    try {
      do {
        this._stepIndex--;
        if (!this.step) break;
        const flow = this.step.flow;

        // Reverse step based on step type
        if (this.step.type === "delete" && this.step.item)
          this.clone.updateSource({ items: [this.step.item] });
        else if (this.step.type === "delete" && this.step.advancement)
          this.advancement.item.createAdvancement(
            this.advancement.typeName,
            this.advancement._source,
            { source: true }
          );
        else if (this.step.type === "reverse")
          await flow.advancement.restore(flow.level, flow.retainedData);
        else if (flow)
          flow.retainedData = await flow.advancement.reverse(flow.level);
        this.clone.reset();
      } while (this.step?.automatic);
    } catch (error) {
      if (!(error instanceof Advancement$1.ERROR)) throw error;
      ui.notifications.error(error.message);
      this.step.automatic = false;
    } finally {
      this._advancing = false;
    }

    if (!render) return;
    if (this.step) this.render(true);
    else this.close({ skipConfirmation: true });
  }

  /* -------------------------------------------- */

  /**
   * Reset back to the manager's initial state.
   * @param {MouseEvent} [event]  The triggering click event if one occurred.
   * @returns {Promise}
   * @private
   */
  async _restart(event) {
    const restart = await Dialog.confirm({
      title: game.i18n.localize("SdS.AdvancementManagerRestartConfirmTitle"),
      content: game.i18n.localize("SdS.AdvancementManagerRestartConfirm"),
    });
    if (!restart) return;
    // While there is still a renderable step.
    while (this.steps.slice(0, this._stepIndex).some((s) => !s.automatic)) {
      await this._backward(event, { render: false });
    }
    this.render(true);
  }

  /* -------------------------------------------- */

  /**
   * Apply changes to actual actor after all choices have been made.
   * @param {Event} event  Button click that triggered the change.
   * @returns {Promise}
   * @private
   */
  async _complete(event) {
    const updates = this.clone.toObject();
    const items = updates.items;
    delete updates.items;

    // Gather changes to embedded items
    const { toCreate, toUpdate, toDelete } = items.reduce(
      (obj, item) => {
        if (!this.actor.items.get(item._id)) {
          obj.toCreate.push(item);
        } else {
          obj.toUpdate.push(item);
          obj.toDelete.findSplice((id) => id === item._id);
        }
        return obj;
      },
      {
        toCreate: [],
        toUpdate: [],
        toDelete: this.actor.items.map((i) => i.id),
      }
    );

    /**
     * A hook event that fires at the final stage of a character's advancement process, before actor and item updates
     * are applied.
     * @function sds.preAdvancementManagerComplete
     * @memberof hookEvents
     * @param {AdvancementManager} advancementManager  The advancement manager.
     * @param {object} actorUpdates                    Updates to the actor.
     * @param {object[]} toCreate                      Items that will be created on the actor.
     * @param {object[]} toUpdate                      Items that will be updated on the actor.
     * @param {string[]} toDelete                      IDs of items that will be deleted on the actor.
     */
    if (
      Hooks.call(
        "sds.preAdvancementManagerComplete",
        this,
        updates,
        toCreate,
        toUpdate,
        toDelete
      ) === false
    ) {
      console.log(
        "AdvancementManager completion was prevented by the 'preAdvancementManagerComplete' hook."
      );
      return this.close({ skipConfirmation: true });
    }

    // Apply changes from clone to original actor
    await Promise.all([
      this.actor.update(updates, { isAdvancement: true }),
      this.actor.createEmbeddedDocuments("Item", toCreate, {
        keepId: true,
        isAdvancement: true,
      }),
      this.actor.updateEmbeddedDocuments("Item", toUpdate, {
        isAdvancement: true,
      }),
      this.actor.deleteEmbeddedDocuments("Item", toDelete, {
        isAdvancement: true,
      }),
    ]);

    /**
     * A hook event that fires when an AdvancementManager is done modifying an actor.
     * @function sds.advancementManagerComplete
     * @memberof hookEvents
     * @param {AdvancementManager} advancementManager The advancement manager that just completed
     */
    Hooks.callAll("sds.advancementManagerComplete", this);

    // Close prompt
    return this.close({ skipConfirmation: true });
  }
}

/**
 * Description for a single part of a property attribution.
 * @typedef {object} AttributionDescription
 * @property {string} label  Descriptive label that will be displayed. If the label is in the form
 *                           of an @ property, the system will try to turn it into a human-readable label.
 * @property {number} mode   Application mode for this step as defined in
 *                           [CONST.ACTIVE_EFFECT_MODES](https://foundryvtt.com/api/module-constants.html#.ACTIVE_EFFECT_MODES).
 * @property {number} value  Value of this step.
 */

/**
 * Interface for viewing what factors went into determining a specific property.
 *
 * @param {Document} object                        The Document that owns the property being attributed.
 * @param {AttributionDescription[]} attributions  An array of all the attribution data.
 * @param {string} property                        Dot separated path to the property.
 * @param {object} [options={}]                    Application rendering options.
 */
class PropertyAttribution extends Application {
  constructor(object, attributions, property, options = {}) {
    super(options);
    this.object = object;
    this.attributions = attributions;
    this.property = property;
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "property-attribution",
      classes: ["sds", "property-attribution"],
      template: "systems/sds/templates/apps/property-attribution.hbs",
      width: 320,
      height: "auto",
    });
  }

  /* -------------------------------------------- */

  /**
   * Render this view as a tooltip rather than a whole window.
   * @param {HTMLElement} element  The element to which the tooltip should be attached.
   */
  async renderTooltip(element) {
    const data = this.getData(this.options);
    const text = (await this._renderInner(data))[0].outerHTML;
    game.tooltip.activate(element, { text, cssClass: "property-attribution" });
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  getData() {
    const property = foundry.utils.getProperty(
      this.object.system,
      this.property
    );
    let total;
    if (Number.isNumeric(property)) total = property;
    else if (typeof property === "object" && Number.isNumeric(property.value))
      total = property.value;
    const sources = foundry.utils.duplicate(this.attributions);
    return {
      caption: this.options.title,
      sources: sources.map((entry) => {
        if (entry.label.startsWith("@"))
          entry.label = this.getPropertyLabel(entry.label.slice(1));
        if (entry.mode === CONST.ACTIVE_EFFECT_MODES.ADD && entry.value < 0) {
          entry.negative = true;
          entry.value = entry.value * -1;
        }
        return entry;
      }),
      total: total,
    };
  }

  /* -------------------------------------------- */

  /**
   * Produce a human-readable and localized name for the provided property.
   * @param {string} property  Dot separated path to the property.
   * @returns {string}         Property name for display.
   */
  getPropertyLabel(property) {
    const parts = property.split(".");
    if (parts[0] === "abilities" && parts[1]) {
      return CONFIG.SdS.abilities[parts[1]] ?? property;
    } else if (property === "attributes.ac.dex" && CONFIG.SdS.abilities.dex) {
      return CONFIG.SdS.abilities.dex;
    } else if (parts[0] === "prof" || property === "attributes.prof") {
      return game.i18n.localize("SdS.Proficiency");
    }
    return property;
  }
}

/**
 * A specialized application used to modify actor traits.
 *
 * @param {Actor5e} actor                       Actor for whose traits are being edited.
 * @param {string} trait                        Trait key as defined in CONFIG.traits.
 * @param {object} [options={}]
 * @param {boolean} [options.allowCustom=true]  Support user custom trait entries.
 */
let TraitSelector$1 = class TraitSelector extends BaseConfigSheet {
  constructor(actor, trait, options) {
    if (!CONFIG.SdS.traits[trait])
      throw new Error(
        `Cannot instantiate TraitSelector with a trait not defined in CONFIG.SdS.traits: ${trait}.`
      );
    if (["saves", "skills"].includes(trait))
      throw new Error(
        `TraitSelector does not support selection of ${trait}. That should be handled through ` +
          "that type's more specialized configuration application."
      );

    super(actor, options);

    /**
     * Trait key as defined in CONFIG.traits.
     * @type {string}
     */
    this.trait = trait;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "trait-selector",
      classes: ["sds", "trait-selector", "subconfig"],
      template: "systems/sds/templates/apps/trait-selector.hbs",
      width: 320,
      height: "auto",
      sheetConfig: false,
      allowCustom: true,
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  get id() {
    return `${this.constructor.name}-${this.trait}-Actor-${this.document.id}`;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  get title() {
    return `${this.document.name}: ${traitLabel(this.trait)}`;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async getData() {
    const path = `system.${actorKeyPath(this.trait)}`;
    const data = foundry.utils.getProperty(this.document, path);

    return {
      ...super.getData(),
      choices: await choices(this.trait, data.value),
      custom: data.custom,
      customPath: "custom" in data ? `${path}.custom` : null,
      bypasses:
        "bypasses" in data
          ? Object.entries(CONFIG.SdS.physicalWeaponProperties).reduce(
              (obj, [k, v]) => {
                obj[k] = { label: v, chosen: data.bypasses.has(k) };
                return obj;
              },
              {}
            )
          : null,
      bypassesPath: "bypasses" in data ? `${path}.bypasses` : null,
    };
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  activateListeners(html) {
    super.activateListeners(html);

    for (const checkbox of html[0].querySelectorAll("input[type='checkbox']")) {
      if (checkbox.checked) this._onToggleCategory(checkbox);
    }
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _getActorOverrides() {
    const overrides = super._getActorOverrides();
    const path = `system.${actorKeyPath(this.trait)}.value`;
    const src = new Set(foundry.utils.getProperty(this.document._source, path));
    const current = foundry.utils.getProperty(this.document, path);
    const delta = current.difference(src);
    for (const choice of delta) {
      overrides.push(`choices.${choice}`);
    }
    return overrides;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async _onChangeInput(event) {
    super._onChangeInput(event);

    if (event.target.name?.startsWith("choices"))
      this._onToggleCategory(event.target);
  }

  /* -------------------------------------------- */

  /**
   * Enable/disable all children when a category is checked.
   * @param {HTMLElement} checkbox  Checkbox that was changed.
   * @protected
   */
  _onToggleCategory(checkbox) {
    const children = checkbox.closest("li")?.querySelector("ol");
    if (!children) return;

    for (const child of children.querySelectorAll("input[type='checkbox']")) {
      child.checked = child.disabled = checkbox.checked;
    }
  }

  /* -------------------------------------------- */

  /**
   * Filter a list of choices that begin with the provided key for update.
   * @param {string} prefix    They initial form prefix under which the choices are grouped.
   * @param {string} path      Path in actor data where the final choices will be saved.
   * @param {object} formData  Form data being prepared. *Will be mutated.*
   * @protected
   */
  _prepareChoices(prefix, path, formData) {
    const chosen = [];
    for (const key of Object.keys(formData).filter((k) =>
      k.startsWith(`${prefix}.`)
    )) {
      if (formData[key]) chosen.push(key.replace(`${prefix}.`, ""));
      delete formData[key];
    }
    formData[path] = chosen;
  }

  /* -------------------------------------------- */

  /** @override */
  async _updateObject(event, formData) {
    const path = `system.${actorKeyPath(this.trait)}`;
    const data = foundry.utils.getProperty(this.document, path);

    this._prepareChoices("choices", `${path}.value`, formData);
    if ("bypasses" in data)
      this._prepareChoices("bypasses", `${path}.bypasses`, formData);

    return this.object.update(formData);
  }
};

/**
 * Extend the basic ActorSheet class to suppose system-specific logic and functionality.
 * @abstract
 */
class ActorSheet5e extends ActorSheet {
  /**
   * Track the set of item filters which are applied
   * @type {Object<string, Set>}
   * @protected
   */
  _filters = {
    inventory: new Set(),
    spellbook: new Set(),
    features: new Set(),
    effects: new Set(),
  };

  /* -------------------------------------------- */

  /**
   * IDs for items on the sheet that have been expanded.
   * @type {Set<string>}
   * @protected
   */
  _expanded = new Set();

  /* -------------------------------------------- */

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      scrollY: [
        ".inventory .inventory-list",
        ".features .inventory-list",
        ".spellbook .inventory-list",
        ".effects .inventory-list",
      ],
      tabs: [
        {
          navSelector: ".tabs",
          contentSelector: ".sheet-body",
          initial: "description",
        },
      ],
      width: 720,
      height: Math.max(
        680,
        Math.max(
          237 + Object.keys(CONFIG.SdS.abilities).length * 70,
          240 + Object.keys(CONFIG.SdS.skills).length * 24
        )
      ),
    });
  }

  /* -------------------------------------------- */

  /**
   * A set of item types that should be prevented from being dropped on this type of actor sheet.
   * @type {Set<string>}
   */
  static unsupportedItemTypes = new Set();

  /* -------------------------------------------- */

  /** @override */
  get template() {
    if (!game.user.isGM && this.actor.limited)
      return "systems/sds/templates/actors/limited-sheet.hbs";
    return `systems/sds/templates/actors/${this.actor.type}-sheet.hbs`;
  }

  /* -------------------------------------------- */
  /*  Context Preparation                         */
  /* -------------------------------------------- */

  /** @override */
  async getData(options) {
    // The Actor's data
    const source = this.actor.toObject();

    // Basic data
    const context = {
      actor: this.actor,
      source: source.system,
      system: this.actor.system,
      items: Array.from(this.actor.items),
      itemContext: {},
      abilities: foundry.utils.deepClone(this.actor.system.abilities),
      skills: foundry.utils.deepClone(this.actor.system.skills ?? {}),
      labels: this._getLabels(),
      movement: this._getMovementSpeed(this.actor.system),
      senses: this._getSenses(this.actor.system),
      effects: ActiveEffect5e.prepareActiveEffectCategories(this.actor.effects),
      warnings: foundry.utils.deepClone(this.actor._preparationWarnings),
      filters: this._filters,
      owner: this.actor.isOwner,
      limited: this.actor.limited,
      options: this.options,
      editable: this.isEditable,
      cssClass: this.actor.isOwner ? "editable" : "locked",
      isCharacter: this.actor.type === "character",
      isNPC: this.actor.type === "npc",
      isVehicle: this.actor.type === "vehicle",
      config: CONFIG.SdS,
      rollableClass: this.isEditable ? "rollable" : "",
      rollData: this.actor.getRollData(),
    };

    /** @deprecated */
    Object.defineProperty(context, "data", {
      get() {
        const msg = `You are accessing the "data" attribute within the rendering context provided by the ActorSheet5e
        class. This attribute has been deprecated in favor of "system" and will be removed in a future release`;
        foundry.utils.logCompatibilityWarning(msg, {
          since: "SdS 2.0",
          until: "SdS 2.2",
        });
        return context.system;
      },
    });

    // Sort Owned Items
    context.items.sort((a, b) => (a.sort || 0) - (b.sort || 0));

    // Temporary HP
    const hp = { ...context.system.attributes.hp };
    if (hp.temp === 0) delete hp.temp;
    if (hp.tempmax === 0) delete hp.tempmax;
    context.hp = hp;

    // Temporary MP
    const mana = { ...context.system.attributes.mana };
    if (mana.temp === 0) delete mana.temp;
    if (mana.tempmax === 0) delete mana.tempmax;
    context.mana = mana;

    // Ability Scores
    for (const [a, abl] of Object.entries(context.abilities)) {
      abl.icon = this._getProficiencyIcon(abl.proficient);
      abl.hover = CONFIG.SdS.proficiencyLevels[abl.proficient];
      abl.label = CONFIG.SdS.abilities[a];
      abl.baseProf = source.system.abilities[a]?.proficient ?? 0;
    }

    // Skills
    for (const [s, skl] of Object.entries(context.skills)) {
      skl.abbreviation = CONFIG.SdS.abilityAbbreviations[skl.ability];
      skl.icon = this._getProficiencyIcon(skl.value);
      skl.hover = CONFIG.SdS.proficiencyLevels[skl.value];
      skl.label = CONFIG.SdS.skills[s]?.label;
      skl.baseValue = source.system.skills[s]?.value ?? 0;
    }

    // Update traits
    context.traits = this._prepareTraits(context.system);

    // Prepare owned items
    this._prepareItems(context);
    context.expandedData = {};
    for (const id of this._expanded) {
      context.expandedData[id] = await this.actor.items
        .get(id)
        .getChatData({ secrets: this.actor.isOwner });
    }

    // Biography HTML enrichment
    context.biographyHTML = await TextEditor.enrichHTML(
      context.system.details.biography.value,
      {
        secrets: this.actor.isOwner,
        rollData: context.rollData,
        async: true,
        relativeTo: this.actor,
      }
    );

    return context;
  }

  /* -------------------------------------------- */

  /**
   * Prepare labels object for the context.
   * @returns {object}           Object containing various labels.
   * @protected
   */
  _getLabels() {
    const labels = { ...this.actor.labels };

    // Currency Labels
    labels.currencies = Object.entries(CONFIG.SdS.currencies).reduce(
      (obj, [k, c]) => {
        obj[k] = c.label;
        return obj;
      },
      {}
    );

    // Proficiency
    labels.proficiency =
      game.settings.get("sds", "proficiencyModifier") === "dice"
        ? `d${this.actor.system.attributes.prof * 2}`
        : `+${this.actor.system.attributes.prof}`;

    return labels;
  }

  /* -------------------------------------------- */

  /**
   * Prepare the display of movement speed data for the Actor.
   * @param {object} systemData               System data for the Actor being prepared.
   * @param {boolean} [largestPrimary=false]  Show the largest movement speed as "primary", otherwise show "walk".
   * @returns {{primary: string, special: string}}
   * @protected
   */
  _getMovementSpeed(systemData, largestPrimary = false) {
    const movement = systemData.attributes.movement ?? {};

    // Prepare an array of available movement speeds
    let speeds = [
      [
        movement.burrow,
        `${game.i18n.localize("SdS.MovementBurrow")} ${movement.burrow}`,
      ],
      [
        movement.climb,
        `${game.i18n.localize("SdS.MovementClimb")} ${movement.climb}`,
      ],
      [
        movement.fly,
        `${game.i18n.localize("SdS.MovementFly")} ${movement.fly}${
          movement.hover ? ` (${game.i18n.localize("SdS.MovementHover")})` : ""
        }`,
      ],
      [
        movement.swim,
        `${game.i18n.localize("SdS.MovementSwim")} ${movement.swim}`,
      ],
    ];
    if (largestPrimary) {
      speeds.push([
        movement.walk,
        `${game.i18n.localize("SdS.MovementWalk")} ${movement.walk}`,
      ]);
    }

    // Filter and sort speeds on their values
    speeds = speeds.filter((s) => s[0]).sort((a, b) => b[0] - a[0]);

    // Case 1: Largest as primary
    if (largestPrimary) {
      let primary = speeds.shift();
      return {
        primary: `${primary ? primary[1] : "0"} ${movement.units}`,
        special: speeds.map((s) => s[1]).join(", "),
      };
    }

    // Case 2: Walk as primary
    else {
      return {
        primary: `${movement.walk || 0} ${movement.units}`,
        special: speeds.length ? speeds.map((s) => s[1]).join(", ") : "",
      };
    }
  }

  /* -------------------------------------------- */

  /**
   * Prepare senses object for display.
   * @param {object} systemData  System data for the Actor being prepared.
   * @returns {object}           Senses grouped by key with localized and formatted string.
   * @protected
   */
  _getSenses(systemData) {
    const senses = systemData.attributes.senses ?? {};
    const tags = {};
    for (let [k, label] of Object.entries(CONFIG.SdS.senses)) {
      const v = senses[k] ?? 0;
      if (v === 0) continue;
      tags[k] = `${game.i18n.localize(label)} ${v} ${senses.units}`;
    }
    if (senses.special) tags.special = senses.special;
    return tags;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async activateEditor(name, options = {}, initialContent = "") {
    options.relativeLinks = true;
    return super.activateEditor(name, options, initialContent);
  }

  /* --------------------------------------------- */
  /*  Property Attribution                         */
  /* --------------------------------------------- */

  /**
   * Break down all of the Active Effects affecting a given target property.
   * @param {string} target               The data property being targeted.
   * @returns {AttributionDescription[]}  Any active effects that modify that property.
   * @protected
   */
  _prepareActiveEffectAttributions(target) {
    return this.actor.effects.reduce((arr, e) => {
      let source = e.sourceName;
      if (e.origin === this.actor.uuid) source = e.label;
      if (!source || e.disabled || e.isSuppressed) return arr;
      const value = e.changes.reduce((n, change) => {
        if (change.key !== target || !Number.isNumeric(change.value)) return n;
        if (change.mode !== CONST.ACTIVE_EFFECT_MODES.ADD) return n;
        return n + Number(change.value);
      }, 0);
      if (!value) return arr;
      arr.push({ value, label: source, mode: CONST.ACTIVE_EFFECT_MODES.ADD });
      return arr;
    }, []);
  }

  /* -------------------------------------------- */

  /**
   * Produce a list of armor class attribution objects.
   * @param {object} rollData             Data provided by Actor5e#getRollData
   * @returns {AttributionDescription[]}  List of attribution descriptions.
   * @protected
   */
  _prepareArmorClassAttribution(rollData) {
    const ac = rollData.attributes.ac;
    const cfg = CONFIG.SdS.armorClasses[ac.calc];
    const attribution = [];

    // Base AC Attribution
    switch (ac.calc) {
      // Flat AC
      case "flat":
        return [
          {
            label: game.i18n.localize("SdS.ArmorClassFlat"),
            mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE,
            value: ac.flat,
          },
        ];

      // Natural armor
      case "natural":
        attribution.push({
          label: game.i18n.localize("SdS.ArmorClassNatural"),
          mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE,
          value: ac.flat,
        });
        break;

      default:
        const formula = ac.calc === "custom" ? ac.formula : cfg.formula;
        let base = ac.base;
        const dataRgx = new RegExp(/@([a-z.0-9_-]+)/gi);
        for (const [match, term] of formula.matchAll(dataRgx)) {
          const value = String(foundry.utils.getProperty(rollData, term));
          if (term === "attributes.ac.armor" || value === "0") continue;
          if (Number.isNumeric(value)) base -= Number(value);
          attribution.push({
            label: match,
            mode: CONST.ACTIVE_EFFECT_MODES.ADD,
            value,
          });
        }
        const armorInFormula = formula.includes("@attributes.ac.armor");
        let label = game.i18n.localize("SdS.PropertyBase");
        if (armorInFormula)
          label =
            this.actor.armor?.name ??
            game.i18n.localize("SdS.ArmorClassUnarmored");
        attribution.unshift({
          label,
          mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE,
          value: base,
        });
        break;
    }

    // Shield
    if (ac.shield !== 0)
      attribution.push({
        label:
          this.actor.shield?.name ?? game.i18n.localize("SdS.EquipmentShield"),
        mode: CONST.ACTIVE_EFFECT_MODES.ADD,
        value: ac.shield,
      });

    // Bonus
    if (ac.bonus !== 0)
      attribution.push(
        ...this._prepareActiveEffectAttributions("system.attributes.ac.bonus")
      );

    // Cover
    if (ac.cover !== 0)
      attribution.push({
        label: game.i18n.localize("SdS.Cover"),
        mode: CONST.ACTIVE_EFFECT_MODES.ADD,
        value: ac.cover,
      });
    return attribution;
  }

  /* -------------------------------------------- */

  /**
   * Prepare the data structure for traits data like languages, resistances & vulnerabilities, and proficiencies.
   * @param {object} systemData  System data for the Actor being prepared.
   * @returns {object}           Prepared trait data.
   * @protected
   */
  _prepareTraits(systemData) {
    const traits = {};
    for (const [trait$1, traitConfig] of Object.entries(CONFIG.SdS.traits)) {
      const key = traitConfig.actorKeyPath ?? `traits.${trait$1}`;
      let data = foundry.utils.getProperty(systemData, key);
      const choices = CONFIG.SdS[traitConfig.configKey];
      if (!data) continue;

      foundry.utils.setProperty(traits, key, data);
      let values = data.value;
      if (!values) values = [];
      else if (values instanceof Set) values = Array.from(values);
      else if (!Array.isArray(values)) values = [values];

      // Split physical damage types from others if bypasses is set
      const physical = [];
      if (data.bypasses?.size) {
        values = values.filter((t) => {
          if (!CONFIG.SdS.physicalDamageTypes[t]) return true;
          physical.push(t);
          return false;
        });
      }

      data.selected = values.reduce((obj, key) => {
        obj[key] = keyLabel(trait$1, key) ?? key;
        return obj;
      }, {});

      // Display bypassed damage types
      if (physical.length) {
        const damageTypesFormatter = new Intl.ListFormat(game.i18n.lang, {
          style: "long",
          type: "conjunction",
        });
        const bypassFormatter = new Intl.ListFormat(game.i18n.lang, {
          style: "long",
          type: "disjunction",
        });
        data.selected.physical = game.i18n.format(
          "SdS.DamagePhysicalBypasses",
          {
            damageTypes: damageTypesFormatter.format(
              physical.map((t) => choices[t])
            ),
            bypassTypes: bypassFormatter.format(
              data.bypasses.map((t) => CONFIG.SdS.physicalWeaponProperties[t])
            ),
          }
        );
      }

      // Add custom entries
      if (data.custom)
        data.custom
          .split(";")
          .forEach((c, i) => (data.selected[`custom${i + 1}`] = c.trim()));
      data.cssClass = !foundry.utils.isEmpty(data.selected) ? "" : "inactive";
    }
    return traits;
  }

  /* -------------------------------------------- */

  /**
   * Prepare the data structure for items which appear on the actor sheet.
   * Each subclass overrides this method to implement type-specific logic.
   * @protected
   */
  _prepareItems() {}

  /* -------------------------------------------- */

  /**
   * Insert a spell into the spellbook object when rendering the character sheet.
   * @param {object} context    Sheet rendering context data being prepared for render.
   * @param {object[]} spells   Spells to be included in the spellbook.
   * @returns {object[]}        Spellbook sections in the proper order.
   * @protected
   */
  _prepareSpellbook(context, spells) {
    const owner = this.actor.isOwner;
    const levels = context.actor.system.spells;
    const spellbook = {};

    // Define section and label mappings
    const sections = { atwill: -20, innate: -10, pact: 0.5 };
    const useLabels = { "-20": "-", "-10": "-", 0: "&infin;" };

    // Format a spellbook entry for a certain indexed level
    const registerSection = (
      sl,
      i,
      label,
      { prepMode = "prepared", value, max, override } = {}
    ) => {
      const aeOverride = foundry.utils.hasProperty(
        this.actor.overrides,
        `system.spells.spell${i}.override`
      );
      spellbook[i] = {
        order: i,
        label: label,
        usesSlots: i > 0,
        canCreate: owner,
        canPrepare: context.actor.type === "character" && i >= 1,
        spells: [],
        uses: useLabels[i] || value || 0,
        slots: useLabels[i] || max || 0,
        override: override || 0,
        dataset: {
          type: "spell",
          level: prepMode in sections ? 1 : i,
          "preparation.mode": prepMode,
        },
        prop: sl,
        editable: context.editable && !aeOverride,
      };
    };

    // Determine the maximum spell level which has a slot
    const maxLevel = Array.fromRange(10).reduce((max, i) => {
      if (i === 0) return max;
      const level = levels[`spell${i}`];
      if ((level.max || level.override) && i > max) max = i;
      return max;
    }, 0);

    // Level-based spellcasters have cantrips and leveled slots
    if (maxLevel > 0) {
      registerSection("spell0", 0, CONFIG.SdS.spellLevels[0]);
      for (let lvl = 1; lvl <= maxLevel; lvl++) {
        const sl = `spell${lvl}`;
        registerSection(sl, lvl, CONFIG.SdS.spellLevels[lvl], levels[sl]);
      }
    }

    // Pact magic users have cantrips and a pact magic section
    if (levels.pact && levels.pact.max) {
      if (!spellbook["0"])
        registerSection("spell0", 0, CONFIG.SdS.spellLevels[0]);
      const l = levels.pact;
      const config = CONFIG.SdS.spellPreparationModes.pact;
      const level = game.i18n.localize(`SdS.SpellLevel${levels.pact.level}`);
      const label = `${config} — ${level}`;
      registerSection("pact", sections.pact, label, {
        prepMode: "pact",
        value: l.value,
        max: l.max,
        override: l.override,
      });
    }

    // Iterate over every spell item, adding spells to the spellbook by section
    spells.forEach((spell) => {
      const mode = spell.system.preparation.mode || "prepared";
      let s = spell.system.level || 0;
      const sl = `spell${s}`;

      // Specialized spellcasting modes (if they exist)
      if (mode in sections) {
        s = sections[mode];
        if (!spellbook[s]) {
          const l = levels[mode] || {};
          const config = CONFIG.SdS.spellPreparationModes[mode];
          registerSection(mode, s, config, {
            prepMode: mode,
            value: l.value,
            max: l.max,
            override: l.override,
          });
        }
      }

      // Sections for higher-level spells which the caster "should not" have, but spell items exist for
      else if (!spellbook[s]) {
        registerSection(sl, s, CONFIG.SdS.spellLevels[s], {
          levels: levels[sl],
        });
      }

      // Add the spell to the relevant heading
      spellbook[s].spells.push(spell);
    });

    // Sort the spellbook by section level
    const sorted = Object.values(spellbook);
    sorted.sort((a, b) => a.order - b.order);
    return sorted;
  }

  /* -------------------------------------------- */

  /**
   * Determine whether an Owned Item will be shown based on the current set of filters.
   * @param {object[]} items       Copies of item data to be filtered.
   * @param {Set<string>} filters  Filters applied to the item list.
   * @returns {object[]}           Subset of input items limited by the provided filters.
   * @protected
   */
  _filterItems(items, filters) {
    return items.filter((item) => {
      // Action usage
      for (let f of ["action", "bonus", "reaction"]) {
        if (filters.has(f) && item.system.activation?.type !== f) return false;
      }

      // Spell-specific filters
      if (filters.has("ritual") && item.system.components.ritual !== true)
        return false;
      if (
        filters.has("concentration") &&
        item.system.components.concentration !== true
      )
        return false;
      if (filters.has("prepared")) {
        if (
          item.system.level === 0 ||
          ["innate", "always"].includes(item.system.preparation.mode)
        )
          return true;
        if (this.actor.type === "npc") return true;
        return item.system.preparation.prepared;
      }

      // Equipment-specific filters
      if (filters.has("equipped") && item.system.equipped !== true)
        return false;
      return true;
    });
  }

  /* -------------------------------------------- */

  /**
   * Get the font-awesome icon used to display a certain level of skill proficiency.
   * @param {number} level  A proficiency mode defined in `CONFIG.SdS.proficiencyLevels`.
   * @returns {string}      HTML string for the chosen icon.
   * @private
   */
  _getProficiencyIcon(level) {
    const icons = {
      0: '<i class="far fa-circle"></i>',
      0.5: '<i class="fas fa-adjust"></i>',
      1: '<i class="fas fa-check"></i>',
      2: '<i class="fas fa-check-double"></i>',
    };
    return icons[level] || icons[0];
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */

  /** @inheritdoc */
  activateListeners(html) {
    // Activate Item Filters
    const filterLists = html.find(".filter-list");
    filterLists.each(this._initializeFilterItemList.bind(this));
    filterLists.on("click", ".filter-item", this._onToggleFilter.bind(this));

    // Item summaries
    html
      .find(".item .item-name.rollable h4")
      .click((event) => this._onItemSummary(event));

    // View Item Sheets
    html.find(".item-edit").click(this._onItemEdit.bind(this));

    // Property attributions
    html
      .find("[data-attribution]")
      .mouseover(this._onPropertyAttribution.bind(this));
    html
      .find(".attributable")
      .mouseover(this._onPropertyAttribution.bind(this));

    // Preparation Warnings
    html.find(".warnings").click(this._onWarningLink.bind(this));

    // Editable Only Listeners
    if (this.isEditable) {
      // Input focus and update
      const inputs = html.find("input");
      inputs.focus((ev) => ev.currentTarget.select());
      inputs
        .addBack()
        .find('[type="text"][data-dtype="Number"]')
        .change(this._onChangeInputDelta.bind(this));

      // Ability Proficiency
      html
        .find(".ability-proficiency")
        .click(this._onToggleAbilityProficiency.bind(this));

      // Toggle Skill Proficiency
      html
        .find(".skill-proficiency")
        .on("click contextmenu", this._onCycleSkillProficiency.bind(this));

      // Trait Selector
      html.find(".trait-selector").click(this._onTraitSelector.bind(this));

      // Configure Special Flags
      html.find(".config-button").click(this._onConfigMenu.bind(this));

      // Owned Item management
      html.find(".item-create").click(this._onItemCreate.bind(this));
      html.find(".item-delete").click(this._onItemDelete.bind(this));
      html
        .find(".item-uses input")
        .click((ev) => ev.target.select())
        .change(this._onUsesChange.bind(this));
      html
        .find(".slot-max-override")
        .click(this._onSpellSlotOverride.bind(this));

      // Active Effect management
      html
        .find(".effect-control")
        .click((ev) => ActiveEffect5e.onManageActiveEffect(ev, this.actor));
      this._disableOverriddenFields(html);
    }

    // Owner Only Listeners
    if (this.actor.isOwner) {
      // Ability Checks
      html.find(".ability-name").click(this._onRollAbilityTest.bind(this));

      // Roll Skill Checks
      html.find(".skill-name").click(this._onRollSkillCheck.bind(this));

      // Item Rolling
      html
        .find(".rollable .item-image")
        .click((event) => this._onItemUse(event));
      html
        .find(".item .item-recharge")
        .click((event) => this._onItemRecharge(event));

      // Item Context Menu
      new ContextMenu(html, ".item-list .item", [], {
        onOpen: this._onItemContext.bind(this),
      });
    }

    // Otherwise, remove rollable classes
    else {
      html.find(".rollable").each((i, el) => el.classList.remove("rollable"));
    }

    // Handle default listeners last so system listeners are triggered first
    super.activateListeners(html);
  }

  /* -------------------------------------------- */

  /**
   * Disable any fields that are overridden by active effects and display an informative tooltip.
   * @param {jQuery} html  The sheet's rendered HTML.
   * @protected
   */
  _disableOverriddenFields(html) {
    for (const override of Object.keys(
      foundry.utils.flattenObject(this.actor.overrides)
    )) {
      html
        .find(`input[name="${override}"],select[name="${override}"]`)
        .each((i, el) => {
          el.disabled = true;
          el.dataset.tooltip = "SdS.ActiveEffectOverrideWarning";
        });

      const [, ability] =
        override.match(/system\.abilities\.([^.]+)\.proficient/) || [];
      if (ability) {
        const toggle = html.find(
          `li[data-ability="${ability}"] .proficiency-toggle`
        );
        toggle.addClass("disabled");
        toggle.attr("data-tooltip", "SdS.ActiveEffectOverrideWarning");
      }

      const [, skill] = override.match(/system\.skills\.([^.]+)\.value/) || [];
      if (skill) {
        const toggle = html.find(
          `li[data-skill="${skill}"] .proficiency-toggle`
        );
        toggle.addClass("disabled");
        toggle.attr("data-tooltip", "SdS.ActiveEffectOverrideWarning");
      }

      const [, spell] =
        override.match(/system\.spells\.(spell\d)\.override/) || [];
      if (spell) {
        html
          .find(`.spell-max[data-level="${spell}"]`)
          .attr("data-tooltip", "SdS.ActiveEffectOverrideWarning");
      }
    }
  }

  /* -------------------------------------------- */

  /**
   * Handle activation of a context menu for an embedded Item or ActiveEffect document.
   * Dynamically populate the array of context menu options.
   * @param {HTMLElement} element       The HTML element for which the context menu is activated
   * @protected
   */
  _onItemContext(element) {
    // Active Effects
    if (element.classList.contains("effect")) {
      const effect = this.actor.effects.get(element.dataset.effectId);
      if (!effect) return;
      ui.context.menuItems = this._getActiveEffectContextOptions(effect);
      Hooks.call(
        "sds.getActiveEffectContextOptions",
        effect,
        ui.context.menuItems
      );
    }

    // Items
    else {
      const item = this.actor.items.get(element.dataset.itemId);
      if (!item) return;
      ui.context.menuItems = this._getItemContextOptions(item);
      Hooks.call("sds.getItemContextOptions", item, ui.context.menuItems);
    }
  }

  /* -------------------------------------------- */

  /**
   * Prepare an array of context menu options which are available for owned ActiveEffect documents.
   * @param {ActiveEffect5e} effect         The ActiveEffect for which the context menu is activated
   * @returns {ContextMenuEntry[]}          An array of context menu options offered for the ActiveEffect
   * @protected
   */
  _getActiveEffectContextOptions(effect) {
    return [
      {
        name: "SdS.ContextMenuActionEdit",
        icon: "<i class='fas fa-edit fa-fw'></i>",
        callback: () => effect.sheet.render(true),
      },
      {
        name: "SdS.ContextMenuActionDuplicate",
        icon: "<i class='fas fa-copy fa-fw'></i>",
        callback: () =>
          effect.clone(
            {
              label: game.i18n.format("DOCUMENT.CopyOf", {
                name: effect.label,
              }),
            },
            { save: true }
          ),
      },
      {
        name: "SdS.ContextMenuActionDelete",
        icon: "<i class='fas fa-trash fa-fw'></i>",
        callback: () => effect.deleteDialog(),
      },
      {
        name: effect.disabled
          ? "SdS.ContextMenuActionEnable"
          : "SdS.ContextMenuActionDisable",
        icon: effect.disabled
          ? "<i class='fas fa-check fa-fw'></i>"
          : "<i class='fas fa-times fa-fw'></i>",
        callback: () => effect.update({ disabled: !effect.disabled }),
      },
    ];
  }

  /* -------------------------------------------- */

  /**
   * Prepare an array of context menu options which are available for owned Item documents.
   * @param {Item5e} item                   The Item for which the context menu is activated
   * @returns {ContextMenuEntry[]}          An array of context menu options offered for the Item
   * @protected
   */
  _getItemContextOptions(item) {
    // Standard Options
    const options = [
      {
        name: "SdS.ContextMenuActionEdit",
        icon: "<i class='fas fa-edit fa-fw'></i>",
        callback: () => item.sheet.render(true),
      },
      {
        name: "SdS.ContextMenuActionDuplicate",
        icon: "<i class='fas fa-copy fa-fw'></i>",
        condition: () =>
          !["race", "background", "class", "subclass"].includes(item.type),
        callback: () =>
          item.clone(
            { name: game.i18n.format("DOCUMENT.CopyOf", { name: item.name }) },
            { save: true }
          ),
      },
      {
        name: "SdS.ContextMenuActionDelete",
        icon: "<i class='fas fa-trash fa-fw'></i>",
        callback: () => item.deleteDialog(),
      },
    ];

    // Toggle Attunement State
    if (
      "attunement" in item.system &&
      item.system.attunement !== CONFIG.SdS.attunementTypes.NONE
    ) {
      const isAttuned =
        item.system.attunement === CONFIG.SdS.attunementTypes.ATTUNED;
      options.push({
        name: isAttuned
          ? "SdS.ContextMenuActionUnattune"
          : "SdS.ContextMenuActionAttune",
        icon: "<i class='fas fa-sun fa-fw'></i>",
        callback: () =>
          item.update({
            "system.attunement":
              CONFIG.SdS.attunementTypes[isAttuned ? "REQUIRED" : "ATTUNED"],
          }),
      });
    }

    // Toggle Equipped State
    if ("equipped" in item.system)
      options.push({
        name: item.system.equipped
          ? "SdS.ContextMenuActionUnequip"
          : "SdS.ContextMenuActionEquip",
        icon: "<i class='fas fa-shield-alt fa-fw'></i>",
        callback: () =>
          item.update({ "system.equipped": !item.system.equipped }),
      });

    // Toggle Prepared State
    if (
      "preparation" in item.system &&
      item.system.preparation?.mode === "prepared"
    )
      options.push({
        name: item.system?.preparation?.prepared
          ? "SdS.ContextMenuActionUnprepare"
          : "SdS.ContextMenuActionPrepare",
        icon: "<i class='fas fa-sun fa-fw'></i>",
        callback: () =>
          item.update({
            "system.preparation.prepared": !item.system.preparation?.prepared,
          }),
      });
    return options;
  }

  /* -------------------------------------------- */

  /**
   * Initialize Item list filters by activating the set of filters which are currently applied
   * @param {number} i  Index of the filter in the list.
   * @param {HTML} ul   HTML object for the list item surrounding the filter.
   * @private
   */
  _initializeFilterItemList(i, ul) {
    const set = this._filters[ul.dataset.filter];
    const filters = ul.querySelectorAll(".filter-item");
    for (let li of filters) {
      if (set.has(li.dataset.filter)) li.classList.add("active");
    }
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */

  /**
   * Handle input changes to numeric form fields, allowing them to accept delta-typed inputs.
   * @param {Event} event  Triggering event.
   * @protected
   */
  _onChangeInputDelta(event) {
    const input = event.target;
    const value = input.value;
    if (["+", "-"].includes(value[0])) {
      const delta = parseFloat(value);
      input.value =
        Number(foundry.utils.getProperty(this.actor, input.name)) + delta;
    } else if (value[0] === "=") input.value = value.slice(1);
  }

  /* -------------------------------------------- */

  /**
   * Handle spawning the TraitSelector application which allows a checkbox of multiple trait options.
   * @param {Event} event   The click event which originated the selection.
   * @private
   */
  _onConfigMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    const button = event.currentTarget;
    let app;
    switch (button.dataset.action) {
      case "armor":
        app = new ActorArmorConfig(this.actor);
        break;
      case "hit-dice":
        app = new ActorHitDiceConfig(this.actor);
        break;
      case "hit-points":
        app = new ActorHitPointsConfig(this.actor);
        break;
      case "mana-points":
        app = new ActorManaPointsConfig(this.actor);
        break;
      case "initiative":
        app = new ActorInitiativeConfig(this.actor);
        break;
      case "movement":
        app = new ActorMovementConfig(this.actor);
        break;
      case "flags":
        app = new ActorSheetFlags(this.actor);
        break;
      case "senses":
        app = new ActorSensesConfig(this.actor);
        break;
      case "type":
        app = new ActorTypeConfig(this.actor);
        break;
      case "ability": {
        const ability =
          event.currentTarget.closest("[data-ability]").dataset.ability;
        app = new ActorAbilityConfig(this.actor, null, ability);
        break;
      }
      case "skill": {
        const skill = event.currentTarget.closest("[data-skill]").dataset.skill;
        app = new ActorSkillConfig(this.actor, null, skill);
        break;
      }
    }
    app?.render(true);
  }

  /* -------------------------------------------- */

  /**
   * Handle cycling proficiency in a Skill.
   * @param {Event} event   A click or contextmenu event which triggered the handler.
   * @returns {Promise}     Updated data for this actor after changes are applied.
   * @private
   */
  _onCycleSkillProficiency(event) {
    if (event.currentTarget.classList.contains("disabled")) return;
    event.preventDefault();
    const parent = event.currentTarget.closest(".skill");
    const field = parent.querySelector('[name$=".value"]');
    const value =
      this.actor._source.system.skills[parent.dataset.skill]?.value ?? 0;

    // Cycle to the next or previous skill level
    const levels = [0, 1, 0.5, 2];
    let idx = levels.indexOf(value);
    const next = idx + (event.type === "click" ? 1 : 3);
    field.value = levels[next % 4];

    // Update the field value and save the form
    return this._onSubmit(event);
  }

  /* -------------------------------------------- */

  /** @override */
  async _onDropActor(event, data) {
    const canPolymorph =
      game.user.isGM ||
      (this.actor.isOwner && game.settings.get("sds", "allowPolymorphing"));
    if (!canPolymorph) return false;

    // Get the target actor
    const cls = getDocumentClass("Actor");
    const sourceActor = await cls.fromDropData(data);
    if (!sourceActor) return;

    // Define a function to record polymorph settings for future use
    const rememberOptions = (html) => {
      const options = {};
      html.find("input").each((i, el) => {
        options[el.name] = el.checked;
      });
      const settings = foundry.utils.mergeObject(
        game.settings.get("sds", "polymorphSettings") ?? {},
        options
      );
      game.settings.set("sds", "polymorphSettings", settings);
      return settings;
    };

    // Create and render the Dialog
    return new Dialog(
      {
        title: game.i18n.localize("SdS.PolymorphPromptTitle"),
        content: {
          options: game.settings.get("sds", "polymorphSettings"),
          settings: CONFIG.SdS.polymorphSettings,
          effectSettings: CONFIG.SdS.polymorphEffectSettings,
          isToken: this.actor.isToken,
        },
        default: "accept",
        buttons: {
          accept: {
            icon: '<i class="fas fa-check"></i>',
            label: game.i18n.localize("SdS.PolymorphAcceptSettings"),
            callback: (html) =>
              this.actor.transformInto(sourceActor, rememberOptions(html)),
          },
          wildshape: {
            icon: CONFIG.SdS.transformationPresets.wildshape.icon,
            label: CONFIG.SdS.transformationPresets.wildshape.label,
            callback: (html) =>
              this.actor.transformInto(
                sourceActor,
                foundry.utils.mergeObject(
                  CONFIG.SdS.transformationPresets.wildshape.options,
                  { transformTokens: rememberOptions(html).transformTokens }
                )
              ),
          },
          polymorph: {
            icon: CONFIG.SdS.transformationPresets.polymorph.icon,
            label: CONFIG.SdS.transformationPresets.polymorph.label,
            callback: (html) =>
              this.actor.transformInto(
                sourceActor,
                foundry.utils.mergeObject(
                  CONFIG.SdS.transformationPresets.polymorph.options,
                  { transformTokens: rememberOptions(html).transformTokens }
                )
              ),
          },
          self: {
            icon: CONFIG.SdS.transformationPresets.polymorphSelf.icon,
            label: CONFIG.SdS.transformationPresets.polymorphSelf.label,
            callback: (html) =>
              this.actor.transformInto(
                sourceActor,
                foundry.utils.mergeObject(
                  CONFIG.SdS.transformationPresets.polymorphSelf.options,
                  { transformTokens: rememberOptions(html).transformTokens }
                )
              ),
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize("Cancel"),
          },
        },
      },
      {
        classes: ["dialog", "sds", "polymorph"],
        width: 900,
        template: "systems/sds/templates/apps/polymorph-prompt.hbs",
      }
    ).render(true);
  }

  /* -------------------------------------------- */

  /** @override */
  async _onDropItemCreate(itemData) {
    let items = itemData instanceof Array ? itemData : [itemData];
    const itemsWithoutAdvancement = items.filter(
      (i) => !i.system.advancement?.length
    );
    const multipleAdvancements =
      items.length - itemsWithoutAdvancement.length > 1;
    if (
      multipleAdvancements &&
      !game.settings.get("sds", "disableAdvancements")
    ) {
      ui.notifications.warn(
        game.i18n.format("SdS.WarnCantAddMultipleAdvancements")
      );
      items = itemsWithoutAdvancement;
    }

    const toCreate = [];
    for (const item of items) {
      const result = await this._onDropSingleItem(item);
      if (result) toCreate.push(result);
    }

    // Create the owned items as normal
    return this.actor.createEmbeddedDocuments("Item", toCreate);
  }

  /* -------------------------------------------- */

  /**
   * Handles dropping of a single item onto this character sheet.
   * @param {object} itemData            The item data to create.
   * @returns {Promise<object|boolean>}  The item data to create after processing, or false if the item should not be
   *                                     created or creation has been otherwise handled.
   * @protected
   */
  async _onDropSingleItem(itemData) {
    // Check to make sure items of this type are allowed on this actor
    if (this.constructor.unsupportedItemTypes.has(itemData.type)) {
      ui.notifications.warn(
        game.i18n.format("SdS.ActorWarningInvalidItem", {
          itemType: game.i18n.localize(CONFIG.Item.typeLabels[itemData.type]),
          actorType: game.i18n.localize(
            CONFIG.Actor.typeLabels[this.actor.type]
          ),
        })
      );
      return false;
    }

    // Create a Consumable spell scroll on the Inventory tab
    if (
      itemData.type === "spell" &&
      (this._tabs[0].active === "inventory" || this.actor.type === "vehicle")
    ) {
      const scroll = await Item5e.createScrollFromSpell(itemData);
      return scroll.toObject();
    }

    // Clean up data
    this._onDropResetData(itemData);

    // Stack identical consumables
    const stacked = this._onDropStackConsumables(itemData);
    if (stacked) return false;

    // Bypass normal creation flow for any items with advancement
    if (
      itemData.system.advancement?.length &&
      !game.settings.get("sds", "disableAdvancements")
    ) {
      const manager = AdvancementManager.forNewItem(this.actor, itemData);
      if (manager.steps.length) {
        manager.render(true);
        return false;
      }
    }
    return itemData;
  }

  /* -------------------------------------------- */

  /**
   * Reset certain pieces of data stored on items when they are dropped onto the actor.
   * @param {object} itemData    The item data requested for creation. **Will be mutated.**
   */
  _onDropResetData(itemData) {
    if (!itemData.system) return;
    ["equipped", "proficient", "prepared"].forEach(
      (k) => delete itemData.system[k]
    );
    if ("attunement" in itemData.system) {
      itemData.system.attunement = Math.min(
        itemData.system.attunement,
        CONFIG.SdS.attunementTypes.REQUIRED
      );
    }
  }

  /* -------------------------------------------- */

  /**
   * Stack identical consumables when a new one is dropped rather than creating a duplicate item.
   * @param {object} itemData         The item data requested for creation.
   * @returns {Promise<Item5e>|null}  If a duplicate was found, returns the adjusted item stack.
   */
  _onDropStackConsumables(itemData) {
    const droppedSourceId = itemData.flags.core?.sourceId;
    if (itemData.type !== "consumable" || !droppedSourceId) return null;
    const similarItem = this.actor.items.find((i) => {
      const sourceId = i.getFlag("core", "sourceId");
      return (
        sourceId &&
        sourceId === droppedSourceId &&
        i.type === "consumable" &&
        i.name === itemData.name
      );
    });
    if (!similarItem) return null;
    return similarItem.update({
      "system.quantity":
        similarItem.system.quantity + Math.max(itemData.system.quantity, 1),
    });
  }

  /* -------------------------------------------- */

  /**
   * Handle enabling editing for a spell slot override value.
   * @param {MouseEvent} event    The originating click event.
   * @private
   */
  async _onSpellSlotOverride(event) {
    const span = event.currentTarget.parentElement;
    const level = span.dataset.level;
    const override =
      this.actor.system.spells[level].override || span.dataset.slots;
    const input = document.createElement("INPUT");
    input.type = "text";
    input.name = `system.spells.${level}.override`;
    input.value = override;
    input.placeholder = span.dataset.slots;
    input.dataset.dtype = "Number";

    // Replace the HTML
    const parent = span.parentElement;
    parent.removeChild(span);
    parent.appendChild(input);
  }

  /* -------------------------------------------- */

  /**
   * Change the uses amount of an Owned Item within the Actor.
   * @param {Event} event        The triggering click event.
   * @returns {Promise<Item5e>}  Updated item.
   * @private
   */
  async _onUsesChange(event) {
    event.preventDefault();
    const itemId = event.currentTarget.closest(".item").dataset.itemId;
    const item = this.actor.items.get(itemId);
    const uses = Math.clamped(
      0,
      parseInt(event.target.value),
      item.system.uses.max
    );
    event.target.value = uses;
    return item.update({ "system.uses.value": uses });
  }

  /* -------------------------------------------- */

  /**
   * Handle using an item from the Actor sheet, obtaining the Item instance, and dispatching to its use method.
   * @param {Event} event  The triggering click event.
   * @returns {Promise}    Results of the usage.
   * @protected
   */
  _onItemUse(event) {
    event.preventDefault();
    const itemId = event.currentTarget.closest(".item").dataset.itemId;
    const item = this.actor.items.get(itemId);
    return item.use({}, { event });
  }

  /* -------------------------------------------- */

  /**
   * Handle attempting to recharge an item usage by rolling a recharge check.
   * @param {Event} event      The originating click event.
   * @returns {Promise<Roll>}  The resulting recharge roll.
   * @private
   */
  _onItemRecharge(event) {
    event.preventDefault();
    const itemId = event.currentTarget.closest(".item").dataset.itemId;
    const item = this.actor.items.get(itemId);
    return item.rollRecharge();
  }

  /* -------------------------------------------- */

  /**
   * Handle toggling and items expanded description.
   * @param {Event} event   Triggering event.
   * @private
   */
  async _onItemSummary(event) {
    event.preventDefault();
    const li = $(event.currentTarget).parents(".item");
    const item = this.actor.items.get(li.data("item-id"));
    const chatData = await item.getChatData({ secrets: this.actor.isOwner });

    // Toggle summary
    if (li.hasClass("expanded")) {
      const summary = li.children(".item-summary");
      summary.slideUp(200, () => summary.remove());
      this._expanded.delete(item.id);
    } else {
      const summary = $(
        await renderTemplate(
          "systems/sds/templates/items/parts/item-summary.hbs",
          chatData
        )
      );
      li.append(summary.hide());
      summary.slideDown(200);
      this._expanded.add(item.id);
    }
    li.toggleClass("expanded");
  }

  /* -------------------------------------------- */

  /**
   * Handle creating a new Owned Item for the actor using initial data defined in the HTML dataset.
   * @param {Event} event          The originating click event.
   * @returns {Promise<Item5e[]>}  The newly created item.
   * @private
   */
  _onItemCreate(event) {
    event.preventDefault();
    const header = event.currentTarget;
    const type = header.dataset.type;

    // Check to make sure the newly created class doesn't take player over level cap
    if (
      type === "class" &&
      this.actor.system.details.level + 1 > CONFIG.SdS.maxLevel
    ) {
      const err = game.i18n.format("SdS.MaxCharacterLevelExceededWarn", {
        max: CONFIG.SdS.maxLevel,
      });
      return ui.notifications.error(err);
    }

    const itemData = {
      name: game.i18n.format("SdS.ItemNew", {
        type: game.i18n.localize(`ITEM.Type${type.capitalize()}`),
      }),
      type: type,
      system: foundry.utils.expandObject({ ...header.dataset }),
    };
    delete itemData.system.type;
    return this.actor.createEmbeddedDocuments("Item", [itemData]);
  }

  /* -------------------------------------------- */

  /**
   * Handle editing an existing Owned Item for the Actor.
   * @param {Event} event    The originating click event.
   * @returns {ItemSheet5e}  The rendered item sheet.
   * @private
   */
  _onItemEdit(event) {
    event.preventDefault();
    const li = event.currentTarget.closest(".item");
    const item = this.actor.items.get(li.dataset.itemId);
    return item.sheet.render(true);
  }

  /* -------------------------------------------- */

  /**
   * Handle deleting an existing Owned Item for the Actor.
   * @param {Event} event  The originating click event.
   * @returns {Promise<Item5e|AdvancementManager>|undefined}  The deleted item if something was deleted or the
   *                                                          advancement manager if advancements need removing.
   * @private
   */
  async _onItemDelete(event) {
    event.preventDefault();
    const li = event.currentTarget.closest(".item");
    const item = this.actor.items.get(li.dataset.itemId);
    if (!item) return;

    // If item has advancement, handle it separately
    if (!game.settings.get("sds", "disableAdvancements")) {
      const manager = AdvancementManager.forDeletedItem(this.actor, item.id);
      if (manager.steps.length) {
        if (["class", "subclass"].includes(item.type)) {
          try {
            const shouldRemoveAdvancements =
              await AdvancementConfirmationDialog.forDelete(item);
            if (shouldRemoveAdvancements) return manager.render(true);
          } catch (err) {
            return;
          }
        } else {
          return manager.render(true);
        }
      }
    }

    return item.deleteDialog();
  }

  /* -------------------------------------------- */

  /**
   * Handle displaying the property attribution tooltip when a property is hovered over.
   * @param {Event} event   The originating mouse event.
   * @private
   */
  async _onPropertyAttribution(event) {
    const element = event.target;
    let property = element.dataset.attribution;
    if (!property) {
      property = element.dataset.property;
      if (!property) return;
      foundry.utils.logCompatibilityWarning(
        "Defining attributable properties on sheets with the `.attributable` class and `data-property` value" +
          " has been deprecated in favor of a single `data-attribution` value.",
        { since: "SdS 2.1.3", until: "SdS 2.4" }
      );
    }

    const rollData = this.actor.getRollData({ deterministic: true });
    const title = game.i18n.localize(element.dataset.attributionCaption);
    let attributions;
    switch (property) {
      case "attributes.ac":
        attributions = this._prepareArmorClassAttribution(rollData);
        break;
    }
    if (!attributions) return;
    new PropertyAttribution(this.actor, attributions, property, {
      title,
    }).renderTooltip(element);
  }

  /* -------------------------------------------- */

  /**
   * Handle rolling an Ability test or saving throw.
   * @param {Event} event      The originating click event.
   * @private
   */
  _onRollAbilityTest(event) {
    event.preventDefault();
    let ability = event.currentTarget.parentElement.dataset.ability;
    this.actor.rollAbility(ability, { event: event });
  }

  /* -------------------------------------------- */

  /**
   * Handle rolling a Skill check.
   * @param {Event} event      The originating click event.
   * @returns {Promise<Roll>}  The resulting roll.
   * @private
   */
  _onRollSkillCheck(event) {
    event.preventDefault();
    const skill = event.currentTarget.closest("[data-skill]").dataset.skill;
    return this.actor.rollSkill(skill, { event: event });
  }

  /* -------------------------------------------- */

  /**
   * Handle toggling Ability score proficiency level.
   * @param {Event} event         The originating click event.
   * @returns {Promise<Actor5e>}  Updated actor instance.
   * @private
   */
  _onToggleAbilityProficiency(event) {
    if (event.currentTarget.classList.contains("disabled")) return;
    event.preventDefault();
    const field = event.currentTarget.previousElementSibling;
    return this.actor.update({ [field.name]: 1 - parseInt(field.value) });
  }

  /* -------------------------------------------- */

  /**
   * Handle toggling of filters to display a different set of owned items.
   * @param {Event} event     The click event which triggered the toggle.
   * @returns {ActorSheet5e}  This actor sheet with toggled filters.
   * @private
   */
  _onToggleFilter(event) {
    event.preventDefault();
    const li = event.currentTarget;
    const set = this._filters[li.parentElement.dataset.filter];
    const filter = li.dataset.filter;
    if (set.has(filter)) set.delete(filter);
    else set.add(filter);
    return this.render();
  }

  /* -------------------------------------------- */

  /**
   * Handle spawning the TraitSelector application which allows a checkbox of multiple trait options.
   * @param {Event} event      The click event which originated the selection.
   * @returns {TraitSelector}  Newly displayed application.
   * @private
   */
  _onTraitSelector(event) {
    event.preventDefault();
    return new TraitSelector$1(
      this.actor,
      event.currentTarget.dataset.trait
    ).render(true);
  }

  /* -------------------------------------------- */

  /**
   * Handle links within preparation warnings.
   * @param {Event} event  The click event on the warning.
   * @protected
   */
  async _onWarningLink(event) {
    event.preventDefault();
    const a = event.target;
    if (!a || !a.dataset.target) return;
    switch (a.dataset.target) {
      case "armor":
        new ActorArmorConfig(this.actor).render(true);
        return;
      default:
        const item = await fromUuid(a.dataset.target);
        item?.sheet.render(true);
    }
  }

  /* -------------------------------------------- */

  /** @override */
  _getHeaderButtons() {
    let buttons = super._getHeaderButtons();
    if (this.actor.isPolymorphed) {
      buttons.unshift({
        label: "SdS.PolymorphRestoreTransformation",
        class: "restore-transformation",
        icon: "fas fa-backward",
        onclick: () => this.actor.revertOriginalForm(),
      });
    }
    return buttons;
  }
}

/**
 * An Actor sheet for player character type actors.
 */
class ActorSheet5eCharacter extends ActorSheet5e {
  /** @inheritDoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["sds", "sheet", "actor", "character"],
    });
  }

  /* -------------------------------------------- */
  /*  Context Preparation                         */
  /* -------------------------------------------- */

  /** @inheritDoc */
  async getData(options = {}) {
    const context = await super.getData(options);

    // Resources
    context.resources = ["primary", "secondary", "tertiary"].reduce(
      (arr, r) => {
        const res = context.actor.system.resources[r] || {};
        res.name = r;
        res.placeholder = game.i18n.localize(`SdS.Resource${r.titleCase()}`);
        if (res && res.value === 0) delete res.value;
        if (res && res.max === 0) delete res.max;
        return arr.concat([res]);
      },
      []
    );

    const classes = this.actor.itemTypes.class;
    return foundry.utils.mergeObject(context, {
      disableExperience: game.settings.get("sds", "disableExperienceTracking"),
      classLabels: classes.map((c) => c.name).join(", "),
      multiclassLabels: classes
        .map((c) =>
          [c.subclass?.name ?? "", c.name, c.system.levels].filterJoin(" ")
        )
        .join(", "),
      weightUnit: game.i18n.localize(
        `SdS.Abbreviation${
          game.settings.get("sds", "metricWeightUnits") ? "Kgs" : "Lbs"
        }`
      ),
      encumbrance: context.system.attributes.encumbrance,
    });
  }

  /* -------------------------------------------- */

  /** @override */
  _prepareItems(context) {
    // Categorize items as inventory, spellbook, features, and classes
    const inventory = {
      weapon: {
        label: "ITEM.TypeWeaponPl",
        items: [],
        dataset: { type: "weapon" },
      },
      equipment: {
        label: "ITEM.TypeEquipmentPl",
        items: [],
        dataset: { type: "equipment" },
      },
      consumable: {
        label: "ITEM.TypeConsumablePl",
        items: [],
        dataset: { type: "consumable" },
      },
      tool: { label: "ITEM.TypeToolPl", items: [], dataset: { type: "tool" } },
      backpack: {
        label: "ITEM.TypeContainerPl",
        items: [],
        dataset: { type: "backpack" },
      },
      loot: { label: "ITEM.TypeLootPl", items: [], dataset: { type: "loot" } },
    };

    // Partition items by category
    let { items, spells, feats, backgrounds, classes, subclasses } =
      context.items.reduce(
        (obj, item) => {
          const { quantity, uses, recharge, target } = item.system;

          // Item details
          const ctx = (context.itemContext[item.id] ??= {});
          ctx.isStack = Number.isNumeric(quantity) && quantity !== 1;
          ctx.attunement = {
            [CONFIG.SdS.attunementTypes.REQUIRED]: {
              icon: "fa-sun",
              cls: "not-attuned",
              title: "SdS.AttunementRequired",
            },
            [CONFIG.SdS.attunementTypes.ATTUNED]: {
              icon: "fa-sun",
              cls: "attuned",
              title: "SdS.AttunementAttuned",
            },
          }[item.system.attunement];

          // Prepare data needed to display expanded sections
          ctx.isExpanded = this._expanded.has(item.id);

          // Item usage
          ctx.hasUses = uses && uses.max > 0;
          ctx.isOnCooldown =
            recharge && !!recharge.value && recharge.charged === false;
          ctx.isDepleted = ctx.isOnCooldown && uses.per && uses.value > 0;
          ctx.hasTarget = !!target && !["none", ""].includes(target.type);

          // Item toggle state
          this._prepareItemToggleState(item, ctx);

          // Classify items into types
          if (item.type === "spell") obj.spells.push(item);
          else if (item.type === "feat") obj.feats.push(item);
          else if (item.type === "background") obj.backgrounds.push(item);
          else if (item.type === "class") obj.classes.push(item);
          else if (item.type === "subclass") obj.subclasses.push(item);
          else if (Object.keys(inventory).includes(item.type))
            obj.items.push(item);
          return obj;
        },
        {
          items: [],
          spells: [],
          feats: [],
          backgrounds: [],
          classes: [],
          subclasses: [],
        }
      );

    // Apply active item filters
    items = this._filterItems(items, this._filters.inventory);
    spells = this._filterItems(spells, this._filters.spellbook);
    feats = this._filterItems(feats, this._filters.features);

    // Organize items
    for (let i of items) {
      const ctx = (context.itemContext[i.id] ??= {});
      ctx.totalWeight = (i.system.quantity * i.system.weight).toNearest(0.1);
      inventory[i.type].items.push(i);
    }

    // Organize Spellbook and count the number of prepared spells (excluding always, at will, etc...)
    const spellbook = this._prepareSpellbook(context, spells);
    const nPrepared = spells.filter((spell) => {
      const prep = spell.system.preparation;
      return (
        spell.system.level > 0 && prep.mode === "prepared" && prep.prepared
      );
    }).length;

    // Sort classes and interleave matching subclasses, put unmatched subclasses into features so they don't disappear
    classes.sort((a, b) => b.system.levels - a.system.levels);
    const maxLevelDelta = CONFIG.SdS.maxLevel - this.actor.system.details.level;
    classes = classes.reduce((arr, cls) => {
      const ctx = (context.itemContext[cls.id] ??= {});
      ctx.availableLevels = Array.fromRange(CONFIG.SdS.maxLevel + 1)
        .slice(1)
        .map((level) => {
          const delta = level - cls.system.levels;
          return { level, delta, disabled: delta > maxLevelDelta };
        });
      arr.push(cls);
      const identifier =
        cls.system.identifier || cls.name.slugify({ strict: true });
      const subclass = subclasses.findSplice(
        (s) => s.system.classIdentifier === identifier
      );
      if (subclass) arr.push(subclass);
      return arr;
    }, []);
    for (const subclass of subclasses) {
      feats.push(subclass);
      const message = game.i18n.format("SdS.SubclassMismatchWarn", {
        name: subclass.name,
        class: subclass.system.classIdentifier,
      });
      context.warnings.push({ message, type: "warning" });
    }

    // Organize Features
    const features = {
      background: {
        label: "ITEM.TypeBackground",
        items: backgrounds,
        hasActions: false,
        dataset: { type: "background" },
      },
      classes: {
        label: "ITEM.TypeClassPl",
        items: classes,
        hasActions: false,
        dataset: { type: "class" },
        isClass: true,
      },
      active: {
        label: "SdS.FeatureActive",
        items: [],
        hasActions: true,
        dataset: { type: "feat", "activation.type": "action" },
      },
      passive: {
        label: "SdS.FeaturePassive",
        items: [],
        hasActions: false,
        dataset: { type: "feat" },
      },
    };
    for (const feat of feats) {
      if (feat.system.activation?.type) features.active.items.push(feat);
      else features.passive.items.push(feat);
    }

    // Assign and return
    context.inventoryFilters = true;
    context.inventory = Object.values(inventory);
    context.spellbook = spellbook;
    context.preparedSpells = nPrepared;
    context.features = Object.values(features);
    context.labels.background = backgrounds[0]?.name;
  }

  /* -------------------------------------------- */

  /**
   * A helper method to establish the displayed preparation state for an item.
   * @param {Item5e} item     Item being prepared for display.
   * @param {object} context  Context data for display.
   * @protected
   */
  _prepareItemToggleState(item, context) {
    if (item.type === "spell") {
      const prep = item.system.preparation || {};
      const isAlways = prep.mode === "always";
      const isPrepared = !!prep.prepared;
      context.toggleClass = isPrepared ? "active" : "";
      if (isAlways) context.toggleClass = "fixed";
      if (isAlways)
        context.toggleTitle = CONFIG.SdS.spellPreparationModes.always;
      else if (isPrepared)
        context.toggleTitle = CONFIG.SdS.spellPreparationModes.prepared;
      else context.toggleTitle = game.i18n.localize("SdS.SpellUnprepared");
    } else {
      const isActive = !!item.system.equipped;
      context.toggleClass = isActive ? "active" : "";
      context.toggleTitle = game.i18n.localize(
        isActive ? "SdS.Equipped" : "SdS.Unequipped"
      );
      context.canToggle = "equipped" in item.system;
    }
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers
  /* -------------------------------------------- */

  /** @inheritDoc */
  activateListeners(html) {
    super.activateListeners(html);
    if (!this.isEditable) return;
    html.find(".level-selector").change(this._onLevelChange.bind(this));
    html.find(".item-toggle").click(this._onToggleItem.bind(this));
    html.find(".short-rest").click(this._onShortRest.bind(this));
    html.find(".long-rest").click(this._onLongRest.bind(this));
    html.find(".rollable[data-action]").click(this._onSheetAction.bind(this));
  }

  /* -------------------------------------------- */

  /**
   * Handle mouse click events for character sheet actions.
   * @param {MouseEvent} event  The originating click event.
   * @returns {Promise}         Dialog or roll result.
   * @private
   */
  _onSheetAction(event) {
    event.preventDefault();
    const button = event.currentTarget;
    switch (button.dataset.action) {
      case "convertCurrency":
        return Dialog.confirm({
          title: `${game.i18n.localize("SdS.CurrencyConvert")}`,
          content: `<p>${game.i18n.localize("SdS.CurrencyConvertHint")}</p>`,
          yes: () => this.actor.convertCurrency(),
        });
      case "rollDeathSave":
        return this.actor.rollDeathSave({ event: event });
      case "rollInitiative":
        return this.actor.rollInitiativeDialog({ event });
    }
  }

  /* -------------------------------------------- */

  /**
   * Respond to a new level being selected from the level selector.
   * @param {Event} event                           The originating change.
   * @returns {Promise<AdvancementManager|Item5e>}  Manager if advancements needed, otherwise updated class item.
   * @private
   */
  async _onLevelChange(event) {
    event.preventDefault();
    const delta = Number(event.target.value);
    const classId = event.target.closest(".item")?.dataset.itemId;
    if (!delta || !classId) return;
    const classItem = this.actor.items.get(classId);
    if (!game.settings.get("sds", "disableAdvancements")) {
      const manager = AdvancementManager.forLevelChange(
        this.actor,
        classId,
        delta
      );
      if (manager.steps.length) {
        if (delta > 0) return manager.render(true);
        try {
          const shouldRemoveAdvancements =
            await AdvancementConfirmationDialog.forLevelDown(classItem);
          if (shouldRemoveAdvancements) return manager.render(true);
        } catch (err) {
          return;
        }
      }
    }
    return classItem.update({
      "system.levels": classItem.system.levels + delta,
    });
  }

  /* -------------------------------------------- */

  /**
   * Handle toggling the state of an Owned Item within the Actor.
   * @param {Event} event        The triggering click event.
   * @returns {Promise<Item5e>}  Item with the updates applied.
   * @private
   */
  _onToggleItem(event) {
    event.preventDefault();
    const itemId = event.currentTarget.closest(".item").dataset.itemId;
    const item = this.actor.items.get(itemId);
    const attr =
      item.type === "spell" ? "system.preparation.prepared" : "system.equipped";
    return item.update({ [attr]: !foundry.utils.getProperty(item, attr) });
  }

  /* -------------------------------------------- */

  /**
   * Take a short rest, calling the relevant function on the Actor instance.
   * @param {Event} event             The triggering click event.
   * @returns {Promise<RestResult>}  Result of the rest action.
   * @private
   */
  async _onShortRest(event) {
    event.preventDefault();
    await this._onSubmit(event);
    return this.actor.shortRest();
  }

  /* -------------------------------------------- */

  /**
   * Take a long rest, calling the relevant function on the Actor instance.
   * @param {Event} event             The triggering click event.
   * @returns {Promise<RestResult>}  Result of the rest action.
   * @private
   */
  async _onLongRest(event) {
    event.preventDefault();
    await this._onSubmit(event);
    return this.actor.longRest();
  }

  /* -------------------------------------------- */

  /** @override */
  async _onDropSingleItem(itemData) {
    // Increment the number of class levels a character instead of creating a new item
    if (itemData.type === "class") {
      const charLevel = this.actor.system.details.level;
      itemData.system.levels = Math.min(
        itemData.system.levels,
        CONFIG.SdS.maxLevel - charLevel
      );
      if (itemData.system.levels <= 0) {
        const err = game.i18n.format("SdS.MaxCharacterLevelExceededWarn", {
          max: CONFIG.SdS.maxLevel,
        });
        ui.notifications.error(err);
        return false;
      }

      const cls = this.actor.itemTypes.class.find(
        (c) => c.identifier === itemData.system.identifier
      );
      if (cls) {
        const priorLevel = cls.system.levels;
        if (!game.settings.get("sds", "disableAdvancements")) {
          const manager = AdvancementManager.forLevelChange(
            this.actor,
            cls.id,
            itemData.system.levels
          );
          if (manager.steps.length) {
            manager.render(true);
            return false;
          }
        }
        cls.update({ "system.levels": priorLevel + itemData.system.levels });
        return false;
      }
    }

    // If a subclass is dropped, ensure it doesn't match another subclass with the same identifier
    else if (itemData.type === "subclass") {
      const other = this.actor.itemTypes.subclass.find(
        (i) => i.identifier === itemData.system.identifier
      );
      if (other) {
        const err = game.i18n.format("SdS.SubclassDuplicateError", {
          identifier: other.identifier,
        });
        ui.notifications.error(err);
        return false;
      }
      const cls = this.actor.itemTypes.class.find(
        (i) => i.identifier === itemData.system.classIdentifier
      );
      if (cls && cls.subclass) {
        const err = game.i18n.format("SdS.SubclassAssignmentError", {
          class: cls.name,
          subclass: cls.subclass.name,
        });
        ui.notifications.error(err);
        return false;
      }
    }
    return super._onDropSingleItem(itemData);
  }
}

/**
 * An Actor sheet for NPC type characters.
 */
class ActorSheet5eNPC extends ActorSheet5e {
  /** @inheritDoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["sds", "sheet", "actor", "npc"],
      width: 600,
    });
  }

  /* -------------------------------------------- */

  /** @override */
  static unsupportedItemTypes = new Set(["background", "class", "subclass"]);

  /* -------------------------------------------- */
  /*  Context Preparation                         */
  /* -------------------------------------------- */

  /** @inheritDoc */
  async getData(options) {
    const context = await super.getData(options);

    // Challenge Rating
    const cr = parseFloat(context.system.details.cr ?? 0);
    const crLabels = { 0: "0", 0.125: "1/8", 0.25: "1/4", 0.5: "1/2" };

    return foundry.utils.mergeObject(context, {
      labels: {
        cr: cr >= 1 ? String(cr) : crLabels[cr] ?? 1,
        type: this.actor.constructor.formatCreatureType(
          context.system.details.type
        ),
        armorType: this.getArmorLabel(),
      },
    });
  }

  /* -------------------------------------------- */

  /** @override */
  _prepareItems(context) {
    // Categorize Items as Features and Spells
    const features = {
      weapons: {
        label: game.i18n.localize("SdS.AttackPl"),
        items: [],
        hasActions: true,
        dataset: { type: "weapon", "weapon-type": "natural" },
      },
      actions: {
        label: game.i18n.localize("SdS.ActionPl"),
        items: [],
        hasActions: true,
        dataset: { type: "feat", "activation.type": "action" },
      },
      passive: {
        label: game.i18n.localize("SdS.Features"),
        items: [],
        dataset: { type: "feat" },
      },
      equipment: {
        label: game.i18n.localize("SdS.Inventory"),
        items: [],
        dataset: { type: "loot" },
      },
    };

    // Start by classifying items into groups for rendering
    let [spells, other] = context.items.reduce(
      (arr, item) => {
        const { quantity, uses, recharge, target } = item.system;
        const ctx = (context.itemContext[item.id] ??= {});
        ctx.isStack = Number.isNumeric(quantity) && quantity !== 1;
        ctx.isExpanded = this._expanded.has(item.id);
        ctx.hasUses = uses && uses.max > 0;
        ctx.isOnCooldown =
          recharge && !!recharge.value && recharge.charged === false;
        ctx.isDepleted = item.isOnCooldown && uses.per && uses.value > 0;
        ctx.hasTarget = !!target && !["none", ""].includes(target.type);
        ctx.canToggle = false;
        if (item.type === "spell") arr[0].push(item);
        else arr[1].push(item);
        return arr;
      },
      [[], []]
    );

    // Apply item filters
    spells = this._filterItems(spells, this._filters.spellbook);
    other = this._filterItems(other, this._filters.features);

    // Organize Spellbook
    const spellbook = this._prepareSpellbook(context, spells);

    // Organize Features
    for (let item of other) {
      if (item.type === "weapon") features.weapons.items.push(item);
      else if (item.type === "feat") {
        if (item.system.activation.type) features.actions.items.push(item);
        else features.passive.items.push(item);
      } else features.equipment.items.push(item);
    }

    // Assign and return
    context.inventoryFilters = true;
    context.features = Object.values(features);
    context.spellbook = spellbook;
  }

  /* -------------------------------------------- */

  /**
   * Format NPC armor information into a localized string.
   * @returns {string}  Formatted armor label.
   */
  getArmorLabel() {
    const ac = this.actor.system.attributes.ac;
    const label = [];
    if (ac.calc === "default")
      label.push(
        this.actor.armor?.name || game.i18n.localize("SdS.ArmorClassUnarmored")
      );
    else label.push(game.i18n.localize(CONFIG.SdS.armorClasses[ac.calc].label));
    if (this.actor.shield) label.push(this.actor.shield.name);
    return label.filterJoin(", ");
  }

  /* -------------------------------------------- */
  /*  Object Updates                              */
  /* -------------------------------------------- */

  /** @inheritDoc */
  async _updateObject(event, formData) {
    // Format NPC Challenge Rating
    const crs = { "1/8": 0.125, "1/4": 0.25, "1/2": 0.5 };
    let crv = "system.details.cr";
    let cr = formData[crv];
    cr = crs[cr] || parseFloat(cr);
    if (cr) formData[crv] = cr < 1 ? cr : parseInt(cr);

    // Parent ActorSheet update steps
    return super._updateObject(event, formData);
  }
}

/**
 * An Actor sheet for Vehicle type actors.
 */
class ActorSheet5eVehicle extends ActorSheet5e {
  /** @inheritDoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["sds", "sheet", "actor", "vehicle"],
    });
  }

  /* -------------------------------------------- */

  /** @override */
  static unsupportedItemTypes = new Set(["background", "class", "subclass"]);

  /* -------------------------------------------- */

  /**
   * Creates a new cargo entry for a vehicle Actor.
   * @type {object}
   */
  static get newCargo() {
    return { name: "", quantity: 1 };
  }

  /* -------------------------------------------- */
  /*  Context Preparation                         */
  /* -------------------------------------------- */

  /**
   * Compute the total weight of the vehicle's cargo.
   * @param {number} totalWeight    The cumulative item weight from inventory items
   * @param {object} actorData      The data object for the Actor being rendered
   * @returns {{max: number, value: number, pct: number}}
   * @private
   */
  _computeEncumbrance(totalWeight, actorData) {
    // Compute currency weight
    const totalCoins = Object.values(actorData.system.currency).reduce(
      (acc, denom) => acc + denom,
      0
    );

    const currencyPerWeight = game.settings.get("sds", "metricWeightUnits")
      ? CONFIG.SdS.encumbrance.currencyPerWeight.metric
      : CONFIG.SdS.encumbrance.currencyPerWeight.imperial;
    totalWeight += totalCoins / currencyPerWeight;

    // Vehicle weights are an order of magnitude greater.
    totalWeight /= game.settings.get("sds", "metricWeightUnits")
      ? CONFIG.SdS.encumbrance.vehicleWeightMultiplier.metric
      : CONFIG.SdS.encumbrance.vehicleWeightMultiplier.imperial;

    // Compute overall encumbrance
    const max = actorData.system.attributes.capacity.cargo;
    const pct = Math.clamped((totalWeight * 100) / max, 0, 100);
    return { value: totalWeight.toNearest(0.1), max, pct };
  }

  /* -------------------------------------------- */

  /** @override */
  _getMovementSpeed(actorData, largestPrimary = true) {
    return super._getMovementSpeed(actorData, largestPrimary);
  }

  /* -------------------------------------------- */

  /**
   * Prepare items that are mounted to a vehicle and require one or more crew to operate.
   * @param {object} item     Copy of the item data being prepared for display.
   * @param {object} context  Display context for the item.
   * @protected
   */
  _prepareCrewedItem(item, context) {
    // Determine crewed status
    const isCrewed = item.system.crewed;
    context.toggleClass = isCrewed ? "active" : "";
    context.toggleTitle = game.i18n.localize(
      `SdS.${isCrewed ? "Crewed" : "Uncrewed"}`
    );

    // Handle crew actions
    if (item.type === "feat" && item.system.activation.type === "crew") {
      context.cover = game.i18n.localize(
        `SdS.${item.system.cover ? "CoverTotal" : "None"}`
      );
      if (item.system.cover === 0.5) context.cover = "½";
      else if (item.system.cover === 0.75) context.cover = "¾";
      else if (item.system.cover === null) context.cover = "—";
    }

    // Prepare vehicle weapons
    if (item.type === "equipment" || item.type === "weapon") {
      context.threshold = item.system.hp.dt ? item.system.hp.dt : "—";
    }
  }

  /* -------------------------------------------- */

  /** @override */
  _prepareItems(context) {
    const cargoColumns = [
      {
        label: game.i18n.localize("SdS.Quantity"),
        css: "item-qty",
        property: "quantity",
        editable: "Number",
      },
    ];

    const equipmentColumns = [
      {
        label: game.i18n.localize("SdS.Quantity"),
        css: "item-qty",
        property: "system.quantity",
        editable: "Number",
      },
      {
        label: game.i18n.localize("SdS.AC"),
        css: "item-ac",
        property: "system.armor.value",
      },
      {
        label: game.i18n.localize("SdS.HP"),
        css: "item-hp",
        property: "system.hp.value",
        editable: "Number",
      },
      {
        label: game.i18n.localize("SdS.Threshold"),
        css: "item-threshold",
        property: "threshold",
      },
    ];

    const features = {
      actions: {
        label: game.i18n.localize("SdS.ActionPl"),
        items: [],
        hasActions: true,
        crewable: true,
        dataset: { type: "feat", "activation.type": "crew" },
        columns: [
          {
            label: game.i18n.localize("SdS.Cover"),
            css: "item-cover",
            property: "cover",
          },
        ],
      },
      equipment: {
        label: game.i18n.localize("ITEM.TypeEquipment"),
        items: [],
        crewable: true,
        dataset: { type: "equipment", "armor.type": "vehicle" },
        columns: equipmentColumns,
      },
      passive: {
        label: game.i18n.localize("SdS.Features"),
        items: [],
        dataset: { type: "feat" },
      },
      reactions: {
        label: game.i18n.localize("SdS.ReactionPl"),
        items: [],
        dataset: { type: "feat", "activation.type": "reaction" },
      },
      weapons: {
        label: game.i18n.localize("ITEM.TypeWeaponPl"),
        items: [],
        crewable: true,
        dataset: { type: "weapon", "weapon-type": "siege" },
        columns: equipmentColumns,
      },
    };

    context.items.forEach((item) => {
      const { uses, recharge } = item.system;
      const ctx = (context.itemContext[item.id] ??= {});
      ctx.canToggle = false;
      ctx.isExpanded = this._expanded.has(item.id);
      ctx.hasUses = uses && uses.max > 0;
      ctx.isOnCooldown =
        recharge && !!recharge.value && recharge.charged === false;
      ctx.isDepleted = item.isOnCooldown && uses.per && uses.value > 0;
    });

    const cargo = {
      crew: {
        label: game.i18n.localize("SdS.VehicleCrew"),
        items: context.actor.system.cargo.crew,
        css: "cargo-row crew",
        editableName: true,
        dataset: { type: "crew" },
        columns: cargoColumns,
      },
      passengers: {
        label: game.i18n.localize("SdS.VehiclePassengers"),
        items: context.actor.system.cargo.passengers,
        css: "cargo-row passengers",
        editableName: true,
        dataset: { type: "passengers" },
        columns: cargoColumns,
      },
      cargo: {
        label: game.i18n.localize("SdS.VehicleCargo"),
        items: [],
        dataset: { type: "loot" },
        columns: [
          {
            label: game.i18n.localize("SdS.Quantity"),
            css: "item-qty",
            property: "system.quantity",
            editable: "Number",
          },
          {
            label: game.i18n.localize("SdS.Price"),
            css: "item-price",
            property: "system.price.value",
            editable: "Number",
          },
          {
            label: game.i18n.localize("SdS.Weight"),
            css: "item-weight",
            property: "system.weight",
            editable: "Number",
          },
        ],
      },
    };

    // Classify items owned by the vehicle and compute total cargo weight
    let totalWeight = 0;
    for (const item of context.items) {
      const ctx = (context.itemContext[item.id] ??= {});
      this._prepareCrewedItem(item, ctx);

      // Handle cargo explicitly
      const isCargo = item.flags.sds?.vehicleCargo === true;
      if (isCargo) {
        totalWeight += (item.system.weight || 0) * item.system.quantity;
        cargo.cargo.items.push(item);
        continue;
      }

      // Handle non-cargo item types
      switch (item.type) {
        case "weapon":
          features.weapons.items.push(item);
          break;
        case "equipment":
          features.equipment.items.push(item);
          break;
        case "feat":
          const act = item.system.activation;
          if (!act.type || act.type === "none")
            features.passive.items.push(item);
          else if (act.type === "reaction") features.reactions.items.push(item);
          else features.actions.items.push(item);
          break;
        default:
          totalWeight += (item.system.weight || 0) * item.system.quantity;
          cargo.cargo.items.push(item);
      }
    }

    // Update the rendering context data
    context.inventoryFilters = false;
    context.features = Object.values(features);
    context.cargo = Object.values(cargo);
    context.encumbrance = this._computeEncumbrance(totalWeight, context);
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);
    if (!this.isEditable) return;

    html.find(".item-toggle").click(this._onToggleItem.bind(this));
    html
      .find(".item-hp input")
      .click((evt) => evt.target.select())
      .change(this._onHPChange.bind(this));

    html
      .find(".item:not(.cargo-row) input[data-property]")
      .click((evt) => evt.target.select())
      .change(this._onEditInSheet.bind(this));

    html
      .find(".cargo-row input")
      .click((evt) => evt.target.select())
      .change(this._onCargoRowChange.bind(this));

    html
      .find(".item:not(.cargo-row) .item-qty input")
      .click((evt) => evt.target.select())
      .change(this._onQtyChange.bind(this));

    if (this.actor.system.attributes.actions.stations) {
      html.find(".counter.actions, .counter.action-thresholds").hide();
    }
  }

  /* -------------------------------------------- */

  /**
   * Handle saving a cargo row (i.e. crew or passenger) in-sheet.
   * @param {Event} event              Triggering event.
   * @returns {Promise<Actor5e>|null}  Actor after update if any changes were made.
   * @private
   */
  _onCargoRowChange(event) {
    event.preventDefault();
    const target = event.currentTarget;
    const row = target.closest(".item");
    const idx = Number(row.dataset.itemIndex);
    const property = row.classList.contains("crew") ? "crew" : "passengers";

    // Get the cargo entry
    const cargo = foundry.utils.deepClone(this.actor.system.cargo[property]);
    const entry = cargo[idx];
    if (!entry) return null;

    // Update the cargo value
    const key = target.dataset.property ?? "name";
    const type = target.dataset.dtype;
    let value = target.value;
    if (type === "Number") value = Number(value);
    entry[key] = value;

    // Perform the Actor update
    return this.actor.update({ [`system.cargo.${property}`]: cargo });
  }

  /* -------------------------------------------- */

  /**
   * Handle editing certain values like quantity, price, and weight in-sheet.
   * @param {Event} event  Triggering event.
   * @returns {Promise<Item5e>}  Item with updates applied.
   * @private
   */
  _onEditInSheet(event) {
    event.preventDefault();
    const itemID = event.currentTarget.closest(".item").dataset.itemId;
    const item = this.actor.items.get(itemID);
    const property = event.currentTarget.dataset.property;
    const type = event.currentTarget.dataset.dtype;
    let value = event.currentTarget.value;
    switch (type) {
      case "Number":
        value = parseInt(value);
        break;
      case "Boolean":
        value = value === "true";
        break;
    }
    return item.update({ [`${property}`]: value });
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  _onItemCreate(event) {
    event.preventDefault();
    // Handle creating a new crew or passenger row.
    const target = event.currentTarget;
    const type = target.dataset.type;
    if (type === "crew" || type === "passengers") {
      const cargo = foundry.utils.deepClone(this.actor.system.cargo[type]);
      cargo.push(this.constructor.newCargo);
      return this.actor.update({ [`system.cargo.${type}`]: cargo });
    }
    return super._onItemCreate(event);
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  _onItemDelete(event) {
    event.preventDefault();
    // Handle deleting a crew or passenger row.
    const row = event.currentTarget.closest(".item");
    if (row.classList.contains("cargo-row")) {
      const idx = Number(row.dataset.itemIndex);
      const type = row.classList.contains("crew") ? "crew" : "passengers";
      const cargo = foundry.utils
        .deepClone(this.actor.system.cargo[type])
        .filter((_, i) => i !== idx);
      return this.actor.update({ [`system.cargo.${type}`]: cargo });
    }
    return super._onItemDelete(event);
  }

  /* -------------------------------------------- */

  /** @override */
  async _onDropSingleItem(itemData) {
    const cargoTypes = [
      "weapon",
      "equipment",
      "consumable",
      "tool",
      "loot",
      "backpack",
    ];
    const isCargo =
      cargoTypes.includes(itemData.type) && this._tabs[0].active === "cargo";
    foundry.utils.setProperty(itemData, "flags.sds.vehicleCargo", isCargo);
    return super._onDropSingleItem(itemData);
  }

  /* -------------------------------------------- */

  /**
   * Special handling for editing HP to clamp it within appropriate range.
   * @param {Event} event  Triggering event.
   * @returns {Promise<Item5e>}  Item after the update is applied.
   * @private
   */
  _onHPChange(event) {
    event.preventDefault();
    const itemID = event.currentTarget.closest(".item").dataset.itemId;
    const item = this.actor.items.get(itemID);
    const hp = Math.clamped(
      0,
      parseInt(event.currentTarget.value),
      item.system.hp.max
    );
    event.currentTarget.value = hp;
    return item.update({ "system.hp.value": hp });
  }

  /* -------------------------------------------- */

  /**
   * Special handling for editing quantity value of equipment and weapons inside the features tab.
   * @param {Event} event  Triggering event.
   * @returns {Promise<Item5e>}  Item after the update is applied.
   * @private
   */
  _onQtyChange(event) {
    event.preventDefault();
    const itemID = event.currentTarget.closest(".item").dataset.itemId;
    const item = this.actor.items.get(itemID);
    const qty = parseInt(event.currentTarget.value);
    event.currentTarget.value = qty;
    return item.update({ "system.quantity": qty });
  }

  /* -------------------------------------------- */

  /**
   * Handle toggling an item's crewed status.
   * @param {Event} event  Triggering event.
   * @returns {Promise<Item5e>}  Item after the toggling is applied.
   * @private
   */
  _onToggleItem(event) {
    event.preventDefault();
    const itemID = event.currentTarget.closest(".item").dataset.itemId;
    const item = this.actor.items.get(itemID);
    return item.update({ "system.crewed": !item.system.crewed });
  }
}

/**
 * A character sheet for group-type Actors.
 * The functionality of this sheet is sufficiently different from other Actor types that we extend the base
 * Foundry VTT ActorSheet instead of the ActorSheet5e abstraction used for character, npc, and vehicle types.
 */
class GroupActorSheet extends ActorSheet {
  /** @inheritDoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["sds", "sheet", "actor", "group"],
      template: "systems/sds/templates/actors/group-sheet.hbs",
      tabs: [
        {
          navSelector: ".tabs",
          contentSelector: ".sheet-body",
          initial: "members",
        },
      ],
      scrollY: [".inventory .inventory-list"],
      width: 620,
      height: 620,
    });
  }

  /* -------------------------------------------- */

  /**
   * A set of item types that should be prevented from being dropped on this type of actor sheet.
   * @type {Set<string>}
   */
  static unsupportedItemTypes = new Set([
    "background",
    "class",
    "subclass",
    "feat",
  ]);

  /* -------------------------------------------- */
  /*  Context Preparation                         */
  /* -------------------------------------------- */

  /** @inheritDoc */
  async getData(options = {}) {
    const context = super.getData(options);
    context.system = context.data.system;
    context.items = Array.from(this.actor.items);

    // Membership
    const { sections, stats } = this.#prepareMembers();
    Object.assign(context, stats);
    context.sections = sections;

    // Movement
    context.movement = this.#prepareMovementSpeed();

    // Inventory
    context.itemContext = {};
    context.inventory = this.#prepareInventory(context);
    context.inventoryFilters = false;
    context.rollableClass = this.isEditable ? "rollable" : "";

    // Biography HTML
    context.descriptionFull = await TextEditor.enrichHTML(
      this.actor.system.description.full,
      {
        secrets: this.actor.isOwner,
        rollData: context.rollData,
        async: true,
        relativeTo: this.actor,
      }
    );

    // Summary tag
    context.summary = this.#getSummary(stats);

    // Text labels
    context.labels = {
      currencies: Object.entries(CONFIG.SdS.currencies).reduce(
        (obj, [k, c]) => {
          obj[k] = c.label;
          return obj;
        },
        {}
      ),
    };
    return context;
  }

  /* -------------------------------------------- */

  /**
   * Prepare a localized summary of group membership.
   * @param {{nMembers: number, nVehicles: number}} stats     The number of members in the group
   * @returns {string}                                        The formatted summary string
   */
  #getSummary(stats) {
    const formatter = new Intl.ListFormat(game.i18n.lang, {
      style: "long",
      type: "conjunction",
    });
    const members = [];
    if (stats.nMembers)
      members.push(
        `${stats.nMembers} ${game.i18n.localize("SdS.GroupMembers")}`
      );
    if (stats.nVehicles)
      members.push(
        `${stats.nVehicles} ${game.i18n.localize("SdS.GroupVehicles")}`
      );
    return game.i18n.format("SdS.GroupSummary", {
      members: formatter.format(members),
    });
  }

  /* -------------------------------------------- */

  /**
   * Prepare membership data for the sheet.
   * @returns {{sections: object, stats: object}}
   */
  #prepareMembers() {
    const stats = {
      currentHP: 0,
      maxHP: 0,
      nMembers: 0,
      nVehicles: 0,
    };
    const sections = {
      character: { label: "ACTOR.TypeCharacterPl", members: [] },
      npc: { label: "ACTOR.TypeNpcPl", members: [] },
      vehicle: { label: "ACTOR.TypeVehiclePl", members: [] },
    };
    for (const member of this.object.system.members) {
      const m = {
        actor: member,
        id: member.id,
        name: member.name,
        img: member.img,
        hp: {},
        displayHPValues: member.testUserPermission(game.user, "OBSERVER"),
      };

      // HP bar
      const hp = member.system.attributes.hp;
      m.hp.current = hp.value + (hp.temp || 0);
      m.hp.max = hp.max + (hp.tempmax || 0);
      m.hp.pct = Math.clamped((m.hp.current / m.hp.max) * 100, 0, 100).toFixed(
        2
      );
      m.hp.color = sds.documents.Actor5e.getHPColor(m.hp.current, m.hp.max).css;
      stats.currentHP += m.hp.current;
      stats.maxHP += m.hp.max;

      if (member.type === "vehicle") stats.nVehicles++;
      else stats.nMembers++;
      sections[member.type].members.push(m);
    }
    for (const [k, section] of Object.entries(sections)) {
      if (!section.members.length) delete sections[k];
    }
    return { sections, stats };
  }

  /* -------------------------------------------- */

  /**
   * Prepare movement speed data for rendering on the sheet.
   * @returns {{secondary: string, primary: string}}
   */
  #prepareMovementSpeed() {
    const movement = this.object.system.attributes.movement;
    let speeds = [
      [
        movement.land,
        `${game.i18n.localize("SdS.MovementLand")} ${movement.land}`,
      ],
      [
        movement.water,
        `${game.i18n.localize("SdS.MovementWater")} ${movement.water}`,
      ],
      [
        movement.air,
        `${game.i18n.localize("SdS.MovementAir")} ${movement.air}`,
      ],
    ];
    speeds = speeds.filter((s) => s[0]).sort((a, b) => b[0] - a[0]);
    const primary = speeds.shift();
    return {
      primary: `${primary ? primary[1] : "0"}`,
      secondary: speeds.map((s) => s[1]).join(", "),
    };
  }

  /* -------------------------------------------- */

  /**
   * Prepare inventory items for rendering on the sheet.
   * @param {object} context  Prepared rendering context.
   * @returns {Object<string,object>}
   */
  #prepareInventory(context) {
    // Categorize as weapons, equipment, containers, and loot
    const sections = {
      weapon: {
        label: "ITEM.TypeWeaponPl",
        items: [],
        hasActions: false,
        dataset: { type: "weapon" },
      },
      equipment: {
        label: "ITEM.TypeEquipmentPl",
        items: [],
        hasActions: false,
        dataset: { type: "equipment" },
      },
      consumable: {
        label: "ITEM.TypeConsumablePl",
        items: [],
        hasActions: false,
        dataset: { type: "consumable" },
      },
      backpack: {
        label: "ITEM.TypeContainerPl",
        items: [],
        hasActions: false,
        dataset: { type: "backpack" },
      },
      loot: {
        label: "ITEM.TypeLootPl",
        items: [],
        hasActions: false,
        dataset: { type: "loot" },
      },
    };

    // Classify items
    for (const item of context.items) {
      const ctx = (context.itemContext[item.id] ??= {});
      const { quantity } = item.system;
      ctx.isStack = Number.isNumeric(quantity) && quantity > 1;
      ctx.canToggle = false;
      if (item.type in sections && item.type !== "loot")
        sections[item.type].items.push(item);
      else sections.loot.items.push(item);
    }
    return sections;
  }

  /* -------------------------------------------- */
  /*  Rendering Workflow                          */
  /* -------------------------------------------- */

  /** @inheritDoc */
  async _render(force, options = {}) {
    for (const member of this.object.system.members) {
      member.apps[this.id] = this;
    }
    return super._render(force, options);
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async close(options = {}) {
    for (const member of this.object.system.members) {
      delete member.apps[this.id];
    }
    return super.close(options);
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */

  /** @inheritDoc */
  activateListeners(html) {
    super.activateListeners(html);
    html.find(".group-member .name").click(this._onClickMemberName.bind(this));
    if (this.isEditable) {
      html.find(".action-button").click(this._onClickActionButton.bind(this));
      html.find(".item-control").click(this._onClickItemControl.bind(this));
      html
        .find(".item .rollable h4")
        .click((event) => this._onClickItemName(event));
      new ContextMenu(html, ".item-list .item", [], {
        onOpen: this._onItemContext.bind(this),
      });
    }
  }

  /* -------------------------------------------- */

  /**
   * Handle clicks to action buttons on the group sheet.
   * @param {PointerEvent} event      The initiating click event
   * @protected
   */
  _onClickActionButton(event) {
    event.preventDefault();
    const button = event.currentTarget;
    switch (button.dataset.action) {
      case "convertCurrency":
        Dialog.confirm({
          title: `${game.i18n.localize("SdS.CurrencyConvert")}`,
          content: `<p>${game.i18n.localize("SdS.CurrencyConvertHint")}</p>`,
          yes: () => this.actor.convertCurrency(),
        });
        break;
      case "removeMember":
        const removeMemberId =
          button.closest("li.group-member").dataset.actorId;
        this.object.system.removeMember(removeMemberId);
        break;
      case "movementConfig":
        const movementConfig = new ActorMovementConfig(this.object);
        movementConfig.render(true);
        break;
    }
  }

  /* -------------------------------------------- */

  /**
   * Handle clicks to item control buttons on the group sheet.
   * @param {PointerEvent} event      The initiating click event
   * @protected
   */
  _onClickItemControl(event) {
    event.preventDefault();
    const button = event.currentTarget;
    switch (button.dataset.action) {
      case "itemCreate":
        this._createItem(button);
        break;
      case "itemDelete":
        const deleteLi = event.currentTarget.closest(".item");
        const deleteItem = this.actor.items.get(deleteLi.dataset.itemId);
        deleteItem.deleteDialog();
        break;
      case "itemEdit":
        const editLi = event.currentTarget.closest(".item");
        const editItem = this.actor.items.get(editLi.dataset.itemId);
        editItem.sheet.render(true);
        break;
    }
  }

  /* -------------------------------------------- */

  /**
   * Handle workflows to create a new Item directly within the Group Actor sheet.
   * @param {HTMLElement} button      The clicked create button
   * @returns {Item5e}                The created embedded Item
   * @protected
   */
  _createItem(button) {
    const type = button.dataset.type;
    const system = { ...button.dataset };
    delete system.type;
    const name = game.i18n.format("SdS.ItemNew", {
      type: game.i18n.localize(`ITEM.Type${type.capitalize()}`),
    });
    const itemData = { name, type, system };
    return this.actor.createEmbeddedDocuments("Item", [itemData]);
  }

  /* -------------------------------------------- */

  /**
   * Handle activation of a context menu for an embedded Item document.
   * Dynamically populate the array of context menu options.
   * Reuse the item context options provided by the base ActorSheet5e class.
   * @param {HTMLElement} element       The HTML element for which the context menu is activated
   * @protected
   */
  _onItemContext(element) {
    const item = this.actor.items.get(element.dataset.itemId);
    if (!item) return;
    ui.context.menuItems = ActorSheet5e.prototype._getItemContextOptions.call(
      this,
      item
    );
    Hooks.call("sds.getItemContextOptions", item, ui.context.menuItems);
  }

  /* -------------------------------------------- */

  /**
   * Handle clicks on member names in the members list.
   * @param {PointerEvent} event      The initiating click event
   * @protected
   */
  _onClickMemberName(event) {
    event.preventDefault();
    const member = event.currentTarget.closest("li.group-member");
    const actor = game.actors.get(member.dataset.actorId);
    if (actor) actor.sheet.render(true, { focus: true });
  }

  /* -------------------------------------------- */

  /**
   * Handle clicks on an item name to expand its description
   * @param {PointerEvent} event      The initiating click event
   * @protected
   */
  _onClickItemName(event) {
    game.system.applications.actor.ActorSheet5e.prototype._onItemSummary.call(
      this,
      event
    );
  }

  /* -------------------------------------------- */

  /** @override */
  async _onDropActor(event, data) {
    if (!this.isEditable) return;
    const cls = getDocumentClass("Actor");
    const sourceActor = await cls.fromDropData(data);
    if (!sourceActor) return;
    return this.object.system.addMember(sourceActor);
  }

  /* -------------------------------------------- */

  /** @override */
  async _onDropItemCreate(itemData) {
    const items = itemData instanceof Array ? itemData : [itemData];

    const toCreate = [];
    for (const item of items) {
      const result = await this._onDropSingleItem(item);
      if (result) toCreate.push(result);
    }

    // Create the owned items as normal
    return this.actor.createEmbeddedDocuments("Item", toCreate);
  }

  /* -------------------------------------------- */

  /**
   * Handles dropping of a single item onto this group sheet.
   * @param {object} itemData            The item data to create.
   * @returns {Promise<object|boolean>}  The item data to create after processing, or false if the item should not be
   *                                     created or creation has been otherwise handled.
   * @protected
   */
  async _onDropSingleItem(itemData) {
    // Check to make sure items of this type are allowed on this actor
    if (this.constructor.unsupportedItemTypes.has(itemData.type)) {
      ui.notifications.warn(
        game.i18n.format("SdS.ActorWarningInvalidItem", {
          itemType: game.i18n.localize(CONFIG.Item.typeLabels[itemData.type]),
          actorType: game.i18n.localize(
            CONFIG.Actor.typeLabels[this.actor.type]
          ),
        })
      );
      return false;
    }

    // Create a Consumable spell scroll on the Inventory tab
    if (itemData.type === "spell") {
      const scroll = await Item5e.createScrollFromSpell(itemData);
      return scroll.toObject();
    }

    // TODO: Stack identical consumables

    return itemData;
  }
}

var _module$9 = /*#__PURE__*/ Object.freeze({
  __proto__: null,
  ActorAbilityConfig: ActorAbilityConfig,
  ActorArmorConfig: ActorArmorConfig,
  ActorHitDiceConfig: ActorHitDiceConfig,
  ActorHitPointsConfig: ActorHitPointsConfig,
  ActorInitiativeConfig: ActorInitiativeConfig,
  ActorMovementConfig: ActorMovementConfig,
  ActorSensesConfig: ActorSensesConfig,
  ActorSheet5e: ActorSheet5e,
  ActorSheet5eCharacter: ActorSheet5eCharacter,
  ActorSheet5eNPC: ActorSheet5eNPC,
  ActorSheet5eVehicle: ActorSheet5eVehicle,
  ActorSheetFlags: ActorSheetFlags,
  ActorSkillConfig: ActorSkillConfig,
  ActorTypeConfig: ActorTypeConfig,
  BaseConfigSheet: ActorSheet5e,
  GroupActorSheet: GroupActorSheet,
  LongRestDialog: LongRestDialog,
  ShortRestDialog: ShortRestDialog,
  TraitSelector: TraitSelector$1,
});

/**
 * Dialog to select which new advancements should be added to an item.
 */
class AdvancementMigrationDialog extends Dialog {
  /** @inheritdoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["sds", "advancement-migration", "dialog"],
      jQuery: false,
      width: 500,
    });
  }

  /* -------------------------------------------- */

  /**
   * A helper constructor function which displays the migration dialog.
   * @param {Item5e} item                    Item to which the advancements are being added.
   * @param {Advancement[]} advancements     New advancements that should be displayed in the prompt.
   * @returns {Promise<Advancement[]|null>}  Resolves with the advancements that should be added, if any.
   */
  static createDialog(item, advancements) {
    const advancementContext = advancements.map((a) => ({
      id: a.id,
      icon: a.icon,
      title: a.title,
      summary: a.levels.length === 1 ? a.summaryForLevel(a.levels[0]) : "",
    }));
    return new Promise(async (resolve, reject) => {
      const dialog = new this({
        title: `${game.i18n.localize("SdS.AdvancementMigrationTitle")}: ${
          item.name
        }`,
        content: await renderTemplate(
          "systems/sds/templates/advancement/advancement-migration-dialog.hbs",
          { item, advancements: advancementContext }
        ),
        buttons: {
          continue: {
            icon: '<i class="fas fa-check"></i>',
            label: game.i18n.localize("SdS.AdvancementMigrationConfirm"),
            callback: (html) =>
              resolve(
                advancements.filter(
                  (a) => html.querySelector(`[name="${a.id}"]`)?.checked
                )
              ),
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize("Cancel"),
            callback: (html) => reject(null),
          },
        },
        default: "continue",
        close: () => reject(null),
      });
      dialog.render(true);
    });
  }
}

/**
 * Presents a list of advancement types to create when clicking the new advancement button.
 * Once a type is selected, this hands the process over to the advancement's individual editing interface.
 *
 * @param {Item5e} item             Item to which this advancement will be added.
 * @param {object} [dialogData={}]  An object of dialog data which configures how the modal window is rendered.
 * @param {object} [options={}]     Dialog rendering options.
 */
class AdvancementSelection extends Dialog {
  constructor(item, dialogData = {}, options = {}) {
    super(dialogData, options);

    /**
     * Store a reference to the Item to which this Advancement is being added.
     * @type {Item5e}
     */
    this.item = item;
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["sds", "sheet", "advancement"],
      template: "systems/sds/templates/advancement/advancement-selection.hbs",
      title: "SdS.AdvancementSelectionTitle",
      width: 500,
      height: "auto",
    });
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  get id() {
    return `item-${this.item.id}-advancement-selection`;
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  getData() {
    const context = { types: {} };
    for (const [name, advancement] of Object.entries(
      CONFIG.SdS.advancementTypes
    )) {
      if (
        !(advancement.prototype instanceof Advancement$1) ||
        !advancement.metadata.validItemTypes.has(this.item.type)
      )
        continue;
      context.types[name] = {
        label: advancement.metadata.title,
        icon: advancement.metadata.icon,
        hint: advancement.metadata.hint,
        disabled: !advancement.availableForItem(this.item),
      };
    }
    context.types = sds.utils.sortObjectEntries(context.types, "label");
    return context;
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  activateListeners(html) {
    super.activateListeners(html);
    html.on("change", "input", this._onChangeInput.bind(this));
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  _onChangeInput(event) {
    const submit = this.element[0].querySelector(
      "button[data-button='submit']"
    );
    submit.disabled = !this.element[0].querySelector(
      "input[name='type']:checked"
    );
  }

  /* -------------------------------------------- */

  /**
   * A helper constructor function which displays the selection dialog and returns a Promise once its workflow has
   * been resolved.
   * @param {Item5e} item                         Item to which the advancement should be added.
   * @param {object} [config={}]
   * @param {boolean} [config.rejectClose=false]  Trigger a rejection if the window was closed without a choice.
   * @param {object} [config.options={}]          Additional rendering options passed to the Dialog.
   * @returns {Promise<AdvancementConfig|null>}   Result of `Item5e#createAdvancement`.
   */
  static async createDialog(item, { rejectClose = false, options = {} } = {}) {
    return new Promise((resolve, reject) => {
      const dialog = new this(
        item,
        {
          title: `${game.i18n.localize("SdS.AdvancementSelectionTitle")}: ${
            item.name
          }`,
          buttons: {
            submit: {
              callback: (html) => {
                const formData = new FormDataExtended(
                  html.querySelector("form")
                );
                const type = formData.get("type");
                resolve(item.createAdvancement(type));
              },
            },
          },
          close: () => {
            if (rejectClose) reject("No advancement type was selected");
            else resolve(null);
          },
        },
        foundry.utils.mergeObject(options, { jQuery: false })
      );
      dialog.render(true);
    });
  }
}

var _module$8 = /*#__PURE__*/ Object.freeze({
  __proto__: null,
  AdvancementConfig: AdvancementConfig,
  AdvancementConfirmationDialog: AdvancementConfirmationDialog,
  AdvancementFlow: AdvancementFlow,
  AdvancementManager: AdvancementManager,
  AdvancementMigrationDialog: AdvancementMigrationDialog,
  AdvancementSelection: AdvancementSelection,
  HitPointsConfig: HitPointsConfig,
  HitPointsFlow: HitPointsFlow,
  ItemGrantConfig: ItemGrantConfig,
  ItemGrantFlow: ItemGrantFlow,
  ScaleValueConfig: ScaleValueConfig,
  ScaleValueFlow: ScaleValueFlow,
});

/**
 * An extension of the base CombatTracker class to provide some 5e-specific functionality.
 * @extends {CombatTracker}
 */
class CombatTracker5e extends CombatTracker {
  /** @inheritdoc */
  async _onCombatantControl(event) {
    const btn = event.currentTarget;
    const combatantId = btn.closest(".combatant").dataset.combatantId;
    const combatant = this.viewed.combatants.get(combatantId);
    if (btn.dataset.control === "rollInitiative" && combatant?.actor)
      return combatant.actor.rollInitiativeDialog();
    return super._onCombatantControl(event);
  }
}

var _module$7 = /*#__PURE__*/ Object.freeze({
  __proto__: null,
  CombatTracker5e: CombatTracker5e,
});

/**
 * A specialized form used to select from a checklist of attributes, traits, or properties.
 * @deprecated since sds 2.1, targeted for removal in 2.3
 */
class TraitSelector extends DocumentSheet {
  constructor(...args) {
    super(...args);

    if (!this.options.suppressWarning)
      foundry.utils.logCompatibilityWarning(
        `${this.constructor.name} has been deprecated in favor of a more specialized TraitSelector ` +
          "available at 'sds.applications.actor.TraitSelector'. Support for the old application will " +
          "be removed in a future version.",
        { since: "SdS 2.1", until: "SdS 2.3" }
      );
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "trait-selector",
      classes: ["sds", "trait-selector", "subconfig"],
      title: "Actor Trait Selection",
      template: "systems/sds/templates/apps/trait-selector.hbs",
      width: 320,
      height: "auto",
      choices: {},
      allowCustom: true,
      minimum: 0,
      maximum: null,
      labelKey: null,
      valueKey: "value",
      customKey: "custom",
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  get title() {
    return this.options.title || super.title;
  }

  /* -------------------------------------------- */

  /**
   * Return a reference to the target attribute
   * @type {string}
   */
  get attribute() {
    return this.options.name;
  }

  /* -------------------------------------------- */

  /** @override */
  getData() {
    const attr = foundry.utils.getProperty(this.object, this.attribute);
    const o = this.options;
    const value = o.valueKey
      ? foundry.utils.getProperty(attr, o.valueKey) ?? []
      : attr;
    const custom = o.customKey
      ? foundry.utils.getProperty(attr, o.customKey) ?? ""
      : "";

    // Populate choices
    const choices = Object.entries(o.choices).reduce((obj, e) => {
      let [k, v] = e;
      const label = o.labelKey
        ? foundry.utils.getProperty(v, o.labelKey) ?? v
        : v;
      obj[k] = { label, chosen: attr ? value.includes(k) : false };
      return obj;
    }, {});

    // Return data
    return {
      choices: choices,
      custom: custom,
      customPath: o.allowCustom ? "custom" : null,
    };
  }

  /* -------------------------------------------- */

  /**
   * Prepare the update data to include choices in the provided object.
   * @param {object} formData  Form data to search for choices.
   * @returns {object}         Updates to apply to target.
   */
  _prepareUpdateData(formData) {
    const o = this.options;
    formData = foundry.utils.expandObject(formData);

    // Obtain choices
    const chosen = Object.entries(formData.choices)
      .filter(([, v]) => v)
      .map(([k]) => k);

    // Object including custom data
    const updateData = {};
    if (o.valueKey) updateData[`${this.attribute}.${o.valueKey}`] = chosen;
    else updateData[this.attribute] = chosen;
    if (o.allowCustom)
      updateData[`${this.attribute}.${o.customKey}`] = formData.custom;

    // Validate the number chosen
    if (o.minimum && chosen.length < o.minimum) {
      return ui.notifications.error(
        `You must choose at least ${o.minimum} options`
      );
    }
    if (o.maximum && chosen.length > o.maximum) {
      return ui.notifications.error(
        `You may choose no more than ${o.maximum} options`
      );
    }

    return updateData;
  }

  /* -------------------------------------------- */

  /** @override */
  async _updateObject(event, formData) {
    const updateData = this._prepareUpdateData(formData);
    if (updateData) this.object.update(updateData);
  }
}

/**
 * Override and extend the core ItemSheet implementation to handle specific item types.
 */
class ItemSheet5e extends ItemSheet {
  constructor(...args) {
    super(...args);

    // Expand the default size of the class sheet
    if (this.object.type === "class") {
      this.options.width = this.position.width = 600;
      this.options.height = this.position.height = 680;
    } else if (this.object.type === "subclass") {
      this.options.height = this.position.height = 540;
    }
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      width: 560,
      height: 400,
      classes: ["sds", "sheet", "item"],
      resizable: true,
      scrollY: [".tab.details"],
      tabs: [
        {
          navSelector: ".tabs",
          contentSelector: ".sheet-body",
          initial: "description",
        },
      ],
      dragDrop: [
        { dragSelector: "[data-effect-id]", dropSelector: ".effects-list" },
        { dragSelector: ".advancement-item", dropSelector: ".advancement" },
      ],
    });
  }

  /* -------------------------------------------- */

  /**
   * Whether advancements on embedded items should be configurable.
   * @type {boolean}
   */
  advancementConfigurationMode = false;

  /* -------------------------------------------- */

  /** @inheritdoc */
  get template() {
    return `systems/sds/templates/items/${this.item.type}.hbs`;
  }

  /* -------------------------------------------- */
  /*  Context Preparation                         */
  /* -------------------------------------------- */

  /** @override */
  async getData(options) {
    const context = await super.getData(options);
    const item = context.item;
    const source = item.toObject();
    const isMountable = this._isItemMountable(item);

    // Game system configuration
    context.config = CONFIG.SdS;

    // Item rendering data
    foundry.utils.mergeObject(context, {
      source: source.system,
      system: item.system,
      labels: item.labels,
      isEmbedded: item.isEmbedded,
      advancementEditable:
        (this.advancementConfigurationMode || !item.isEmbedded) &&
        context.editable,
      rollData: this.item.getRollData(),

      // Item Type, Status, and Details
      itemType: game.i18n.localize(`ITEM.Type${this.item.type.titleCase()}`),
      itemStatus: this._getItemStatus(),
      itemProperties: this._getItemProperties(),
      baseItems: await this._getItemBaseTypes(),
      isPhysical: item.system.hasOwnProperty("quantity"),

      // Action Details
      hasAttackRoll: item.hasAttack,
      isHealing: item.system.actionType === "heal",
      isFlatDC: item.system.save?.scaling === "flat",
      isLine: ["line", "wall"].includes(item.system.target?.type),

      // Vehicles
      isCrewed: item.system.activation?.type === "crew",
      isMountable,

      // Spell
      isSpell: this.item.type == "spell",
      isElemental: Boolean(
        item.system.schools?.includes("elem") ||
          item.system.spell_schools?.includes("elem")
      ),

      // Armor Class
      isArmor: item.isArmor,
      hasAC: item.isArmor || isMountable,
      hasDexModifier: item.isArmor && item.system.armor?.type !== "shield",

      // Advancement
      advancement: this._getItemAdvancement(item),

      // Prepare Active Effects
      effects: ActiveEffect5e.prepareActiveEffectCategories(item.effects),
    });
    context.abilityConsumptionTargets = this._getItemConsumptionTargets();

    /** @deprecated */
    Object.defineProperty(context, "data", {
      get() {
        const msg = `You are accessing the "data" attribute within the rendering context provided by the ItemSheet5e
        class. This attribute has been deprecated in favor of "system" and will be removed in a future release`;
        foundry.utils.logCompatibilityWarning(msg, {
          since: "SdS 2.0",
          until: "SdS 2.2",
        });
        return context.system;
      },
    });

    // Special handling for specific item types
    switch (item.type) {
      case "feat":
        const featureType = CONFIG.SdS.featureTypes[item.system.type?.value];
        if (featureType) {
          context.itemType = featureType.label;
          context.featureSubtypes = featureType.subtypes;
        }
        break;
      case "spell":
        context.spellComponents = {
          ...CONFIG.SdS.spellComponents,
          ...CONFIG.SdS.spellTags,
        };
        break;
    }

    // Enrich HTML description
    context.descriptionHTML = await TextEditor.enrichHTML(
      item.system.description.value,
      {
        secrets: item.isOwner,
        async: true,
        relativeTo: this.item,
        rollData: context.rollData,
      }
    );
    return context;
  }

  /* -------------------------------------------- */

  /**
   * Get the display object used to show the advancement tab.
   * @param {Item5e} item  The item for which the advancement is being prepared.
   * @returns {object}     Object with advancement data grouped by levels.
   */
  _getItemAdvancement(item) {
    if (!item.system.advancement) return {};
    const advancement = {};
    const configMode = !item.parent || this.advancementConfigurationMode;
    const maxLevel = !configMode
      ? item.system.levels ??
        item.class?.system.levels ??
        item.parent.system.details?.level ??
        -1
      : -1;

    // Improperly configured advancements
    if (item.advancement.needingConfiguration.length) {
      advancement.unconfigured = {
        items: item.advancement.needingConfiguration.map((a) => ({
          id: a.id,
          order: a.constructor.order,
          title: a.title,
          icon: a.icon,
          classRestriction: a.classRestriction,
          configured: false,
        })),
        configured: "partial",
      };
    }

    // All other advancements by level
    for (let [level, advancements] of Object.entries(
      item.advancement.byLevel
    )) {
      if (!configMode)
        advancements = advancements.filter((a) => a.appliesToClass);
      const items = advancements.map((advancement) => ({
        id: advancement.id,
        order: advancement.sortingValueForLevel(level),
        title: advancement.titleForLevel(level, { configMode }),
        icon: advancement.icon,
        classRestriction: advancement.classRestriction,
        summary: advancement.summaryForLevel(level, { configMode }),
        configured: advancement.configuredForLevel(level),
      }));
      if (!items.length) continue;
      advancement[level] = {
        items: items.sort((a, b) => a.order.localeCompare(b.order)),
        configured:
          level > maxLevel
            ? false
            : items.some((a) => !a.configured)
            ? "partial"
            : "full",
      };
    }
    return advancement;
  }

  /* -------------------------------------------- */

  /**
   * Get the base weapons and tools based on the selected type.
   * @returns {Promise<object>}  Object with base items for this type formatted for selectOptions.
   * @protected
   */
  async _getItemBaseTypes() {
    const type = this.item.type === "equipment" ? "armor" : this.item.type;
    const baseIds = CONFIG.SdS[`${type}Ids`];
    if (baseIds === undefined) return {};

    const typeProperty = type === "armor" ? "armor.type" : `${type}Type`;
    const baseType = foundry.utils.getProperty(this.item.system, typeProperty);

    const items = {};
    for (const [name, id] of Object.entries(baseIds)) {
      const baseItem = await getBaseItem(id);
      if (
        baseType !== foundry.utils.getProperty(baseItem?.system, typeProperty)
      )
        continue;
      items[name] = baseItem.name;
    }
    return Object.fromEntries(
      Object.entries(items).sort((lhs, rhs) => lhs[1].localeCompare(rhs[1]))
    );
  }

  /* -------------------------------------------- */

  /**
   * Get the valid item consumption targets which exist on the actor
   * @returns {Object<string>}   An object of potential consumption targets
   * @private
   */
  _getItemConsumptionTargets() {
    const consume = this.item.system.consume || {};
    if (!consume.type) return [];
    const actor = this.item.actor;
    if (!actor) return {};

    // Ammunition
    if (consume.type === "ammo") {
      return actor.itemTypes.consumable.reduce((ammo, i) => {
        if (i.system.consumableType === "ammo")
          ammo[i.id] = `${i.name} (${i.system.quantity})`;
        return ammo;
      }, {});
    }

    // Attributes
    else if (consume.type === "attribute") {
      const attributes = TokenDocument.implementation.getConsumedAttributes(
        actor.system
      );
      attributes.bar.forEach((a) => a.push("value"));
      return attributes.bar.concat(attributes.value).reduce((obj, a) => {
        let k = a.join(".");
        obj[k] = k;
        return obj;
      }, {});
    }

    // Hit Dice
    else if (consume.type === "hitDice") {
      return {
        smallest: game.i18n.localize("SdS.ConsumeHitDiceSmallest"),
        ...CONFIG.SdS.hitDieTypes.reduce((obj, hd) => {
          obj[hd] = hd;
          return obj;
        }, {}),
        largest: game.i18n.localize("SdS.ConsumeHitDiceLargest"),
      };
    }

    // Materials
    else if (consume.type === "material") {
      return actor.items.reduce((obj, i) => {
        if (["consumable", "loot"].includes(i.type) && !i.system.activation) {
          obj[i.id] = `${i.name} (${i.system.quantity})`;
        }
        return obj;
      }, {});
    }

    // Charges
    else if (consume.type === "charges") {
      return actor.items.reduce((obj, i) => {
        // Limited-use items
        const uses = i.system.uses || {};
        if (uses.per && uses.max) {
          const label =
            uses.per === "charges"
              ? ` (${game.i18n.format("SdS.AbilityUseChargesLabel", {
                  value: uses.value,
                })})`
              : ` (${game.i18n.format("SdS.AbilityUseConsumableLabel", {
                  max: uses.max,
                  per: uses.per,
                })})`;
          obj[i.id] = i.name + label;
        }

        // Recharging items
        const recharge = i.system.recharge || {};
        if (recharge.value)
          obj[i.id] = `${i.name} (${game.i18n.format("SdS.Recharge")})`;
        return obj;
      }, {});
    } else return {};
  }

  /* -------------------------------------------- */

  /**
   * Get the text item status which is shown beneath the Item type in the top-right corner of the sheet.
   * @returns {string|null}  Item status string if applicable to item's type.
   * @protected
   */
  _getItemStatus() {
    switch (this.item.type) {
      case "class":
        return game.i18n.format("SdS.LevelCount", {
          ordinal: this.item.system.levels.ordinalString(),
        });
      case "equipment":
      case "weapon":
        return game.i18n.localize(
          this.item.system.equipped ? "SdS.Equipped" : "SdS.Unequipped"
        );
      case "feat":
        const typeConfig = CONFIG.SdS.featureTypes[this.item.system.type.value];
        if (typeConfig?.subtypes)
          return typeConfig.subtypes[this.item.system.type.subtype] ?? null;
        break;
      case "spell":
        return CONFIG.SdS.spellPreparationModes[this.item.system.preparation];
      case "tool":
        return game.i18n.localize(
          this.item.system.proficient ? "SdS.Proficient" : "SdS.NotProficient"
        );
    }
    return null;
  }

  /* -------------------------------------------- */

  /**
   * Get the Array of item properties which are used in the small sidebar of the description tab.
   * @returns {string[]}   List of property labels to be shown.
   * @private
   */
  _getItemProperties() {
    const props = [];
    const labels = this.item.labels;
    switch (this.item.type) {
      case "equipment":
        props.push(CONFIG.SdS.equipmentTypes[this.item.system.armor.type]);
        if (this.item.isArmor || this._isItemMountable(this.item))
          props.push(labels.armor);
        break;
      case "feat":
        props.push(labels.featType);
        break;
      case "spell":
        props.push(
          ...labels.schools.map((v) => SdS.spellSchools[v]),
          ...labels.elements.map((v) => SdS.spellElements[v]),
          labels.components.vsm,
          labels.materials,
          ...labels.components.tags
        );
        break;
      case "weapon":
        for (const [k, v] of Object.entries(this.item.system.properties)) {
          if (v === true) props.push(CONFIG.SdS.weaponProperties[k]);
        }
        break;
    }

    // Action type
    if (this.item.system.actionType) {
      props.push(CONFIG.SdS.itemActionTypes[this.item.system.actionType]);
    }

    // Action usage
    if (
      this.item.type !== "weapon" &&
      !foundry.utils.isEmpty(this.item.system.activation)
    ) {
      props.push(
        labels.activation,
        labels.range,
        labels.target,
        labels.duration
      );
    }
    return props.filter((p) => !!p);
  }

  /* -------------------------------------------- */

  /**
   * Is this item a separate large object like a siege engine or vehicle component that is
   * usually mounted on fixtures rather than equipped, and has its own AC and HP.
   * @param {object} item  Copy of item data being prepared for display.
   * @returns {boolean}    Is item siege weapon or vehicle equipment?
   * @private
   */
  _isItemMountable(item) {
    return (
      (item.type === "weapon" && item.system.weaponType === "siege") ||
      (item.type === "equipment" && item.system.armor.type === "vehicle")
    );
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  setPosition(position = {}) {
    if (!(this._minimized || position.height)) {
      position.height =
        this._tabs[0].active === "details"
          ? "auto"
          : Math.max(this.height, this.options.height);
    }
    return super.setPosition(position);
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async activateEditor(name, options = {}, initialContent = "") {
    options.relativeLinks = true;
    options.plugins = {
      menu: ProseMirror.ProseMirrorMenu.build(ProseMirror.defaultSchema, {
        compact: true,
        destroyOnSave: true,
        onSave: () => this.saveEditor(name, { remove: true }),
      }),
    };
    return super.activateEditor(name, options, initialContent);
  }

  /* -------------------------------------------- */
  /*  Form Submission                             */
  /* -------------------------------------------- */

  /** @inheritDoc */
  _getSubmitData(updateData = {}) {
    const formData = foundry.utils.expandObject(
      super._getSubmitData(updateData)
    );

    // Handle Damage array
    const damage = formData.system?.damage;
    if (damage)
      damage.parts = Object.values(damage?.parts || {}).map((d) => [
        d[0] || "",
        d[1] || "",
      ]);

    // Check max uses formula
    const uses = formData.system?.uses;
    if (uses?.max) {
      const maxRoll = new Roll(uses.max);
      if (!maxRoll.isDeterministic) {
        uses.max = this.item._source.system.uses.max;
        this.form.querySelector("input[name='system.uses.max']").value =
          uses.max;
        return ui.notifications.error(
          game.i18n.format("SdS.FormulaCannotContainDiceError", {
            name: game.i18n.localize("SdS.LimitedUses"),
          })
        );
      }
    }

    // Check duration value formula
    const duration = formData.system?.duration;
    if (duration?.value) {
      const durationRoll = new Roll(duration.value);
      if (!durationRoll.isDeterministic) {
        duration.value = this.item._source.system.duration.value;
        this.form.querySelector("input[name='system.duration.value']").value =
          duration.value;
        return ui.notifications.error(
          game.i18n.format("SdS.FormulaCannotContainDiceError", {
            name: game.i18n.localize("SdS.Duration"),
          })
        );
      }
    }

    // Check class identifier
    if (
      formData.system?.identifier &&
      !sds.utils.validators.isValidIdentifier(formData.system.identifier)
    ) {
      formData.system.identifier = this.item._source.system.identifier;
      this.form.querySelector("input[name='system.identifier']").value =
        formData.system.identifier;
      return ui.notifications.error(game.i18n.localize("SdS.IdentifierError"));
    }

    // Return the flattened submission data
    return foundry.utils.flattenObject(formData);
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  activateListeners(html) {
    super.activateListeners(html);
    if (this.isEditable) {
      html.find(".damage-control").click(this._onDamageControl.bind(this));
      html.find(".trait-selector").click(this._onConfigureTraits.bind(this));
      html.find(".effect-control").click((ev) => {
        if (this.item.isOwned)
          return ui.notifications.warn(
            "Managing Active Effects within an Owned Item is not currently supported and will be added in a subsequent update."
          );
        ActiveEffect5e.onManageActiveEffect(ev, this.item);
      });
      html.find(".advancement .item-control").click((event) => {
        const t = event.currentTarget;
        if (t.dataset.action) this._onAdvancementAction(t, t.dataset.action);
      });
    }

    // Advancement context menu
    const contextOptions = this._getAdvancementContextMenuOptions();
    /**
     * A hook event that fires when the context menu for the advancements list is constructed.
     * @function sds.getItemAdvancementContext
     * @memberof hookEvents
     * @param {jQuery} html                      The HTML element to which the context options are attached.
     * @param {ContextMenuEntry[]} entryOptions  The context menu entries.
     */
    Hooks.call("sds.getItemAdvancementContext", html, contextOptions);
    if (contextOptions)
      new ContextMenu(html, ".advancement-item", contextOptions);
  }

  /* -------------------------------------------- */

  /**
   * Get the set of ContextMenu options which should be applied for advancement entries.
   * @returns {ContextMenuEntry[]}  Context menu entries.
   * @protected
   */
  _getAdvancementContextMenuOptions() {
    const condition = (li) =>
      (this.advancementConfigurationMode || !this.isEmbedded) &&
      this.isEditable;
    return [
      {
        name: "SdS.AdvancementControlEdit",
        icon: "<i class='fas fa-edit fa-fw'></i>",
        condition,
        callback: (li) => this._onAdvancementAction(li[0], "edit"),
      },
      {
        name: "SdS.AdvancementControlDuplicate",
        icon: "<i class='fas fa-copy fa-fw'></i>",
        condition: (li) => {
          const id = li[0].closest(".advancement-item")?.dataset.id;
          const advancement = this.item.advancement.byId[id];
          return (
            condition() && advancement?.constructor.availableForItem(this.item)
          );
        },
        callback: (li) => this._onAdvancementAction(li[0], "duplicate"),
      },
      {
        name: "SdS.AdvancementControlDelete",
        icon: "<i class='fas fa-trash fa-fw' style='color: rgb(255, 65, 65);'></i>",
        condition,
        callback: (li) => this._onAdvancementAction(li[0], "delete"),
      },
    ];
  }

  /* -------------------------------------------- */

  /**
   * Add or remove a damage part from the damage formula.
   * @param {Event} event             The original click event.
   * @returns {Promise<Item5e>|null}  Item with updates applied.
   * @private
   */
  async _onDamageControl(event) {
    event.preventDefault();
    const a = event.currentTarget;

    // Add new damage component
    if (a.classList.contains("add-damage")) {
      await this._onSubmit(event); // Submit any unsaved changes
      const damage = this.item.system.damage;
      return this.item.update({
        "system.damage.parts": damage.parts.concat([["", ""]]),
      });
    }

    // Remove a damage component
    if (a.classList.contains("delete-damage")) {
      await this._onSubmit(event); // Submit any unsaved changes
      const li = a.closest(".damage-part");
      const damage = foundry.utils.deepClone(this.item.system.damage);
      damage.parts.splice(Number(li.dataset.damagePart), 1);
      return this.item.update({ "system.damage.parts": damage.parts });
    }
  }
  /* -------------------------------------------- */

  /** @inheritdoc */
  _onDragStart(event) {
    const li = event.currentTarget;
    if (event.target.classList.contains("content-link")) return;

    // Create drag data
    let dragData;

    // Active Effect
    if (li.dataset.effectId) {
      const effect = this.item.effects.get(li.dataset.effectId);
      dragData = effect.toDragData();
    } else if (li.classList.contains("advancement-item")) {
      dragData = this.item.advancement.byId[li.dataset.id]?.toDragData();
    }

    if (!dragData) return;

    // Set data transfer
    event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _onDrop(event) {
    const data = TextEditor.getDragEventData(event);
    const item = this.item;

    /**
     * A hook event that fires when some useful data is dropped onto an ItemSheet5e.
     * @function sds.dropItemSheetData
     * @memberof hookEvents
     * @param {Item5e} item                  The Item5e
     * @param {ItemSheet5e} sheet            The ItemSheet5e application
     * @param {object} data                  The data that has been dropped onto the sheet
     * @returns {boolean}                    Explicitly return `false` to prevent normal drop handling.
     */
    const allowed = Hooks.call("sds.dropItemSheetData", item, this, data);
    if (allowed === false) return;

    switch (data.type) {
      case "ActiveEffect":
        return this._onDropActiveEffect(event, data);
      case "Advancement":
      case "Item":
        return this._onDropAdvancement(event, data);
    }
  }

  /* -------------------------------------------- */

  /**
   * Handle the dropping of ActiveEffect data onto an Item Sheet
   * @param {DragEvent} event                  The concluding DragEvent which contains drop data
   * @param {object} data                      The data transfer extracted from the event
   * @returns {Promise<ActiveEffect|boolean>}  The created ActiveEffect object or false if it couldn't be created.
   * @protected
   */
  async _onDropActiveEffect(event, data) {
    const effect = await ActiveEffect.implementation.fromDropData(data);
    if (!this.item.isOwner || !effect) return false;
    if (
      this.item.uuid === effect.parent.uuid ||
      this.item.uuid === effect.origin
    )
      return false;
    return ActiveEffect.create(
      {
        ...effect.toObject(),
        origin: this.item.uuid,
      },
      { parent: this.item }
    );
  }

  /* -------------------------------------------- */

  /**
   * Handle the dropping of an advancement or item with advancements onto the advancements tab.
   * @param {DragEvent} event                  The concluding DragEvent which contains drop data.
   * @param {object} data                      The data transfer extracted from the event.
   */
  async _onDropAdvancement(event, data) {
    let advancements;
    let showDialog = false;
    if (data.type === "Advancement") {
      advancements = [await fromUuid(data.uuid)];
    } else if (data.type === "Item") {
      const item = await Item.implementation.fromDropData(data);
      if (!item) return false;
      advancements = Object.values(item.advancement.byId);
      showDialog = true;
    } else {
      return false;
    }
    advancements = advancements.filter((a) => {
      return (
        !this.item.advancement.byId[a.id] &&
        a.constructor.metadata.validItemTypes.has(this.item.type) &&
        a.constructor.availableForItem(this.item)
      );
    });

    // Display dialog prompting for which advancements to add
    if (showDialog) {
      try {
        advancements = await AdvancementMigrationDialog.createDialog(
          this.item,
          advancements
        );
      } catch (err) {
        return false;
      }
    }

    if (!advancements.length) return false;
    if (
      this.item.isEmbedded &&
      !game.settings.get("sds", "disableAdvancements")
    ) {
      const manager = AdvancementManager.forNewAdvancement(
        this.item.actor,
        this.item.id,
        advancements
      );
      if (manager.steps.length) return manager.render(true);
    }

    // If no advancements need to be applied, just add them to the item
    const advancementArray = foundry.utils.deepClone(
      this.item.system.advancement
    );
    advancementArray.push(...advancements.map((a) => a.toObject()));
    this.item.update({ "system.advancement": advancementArray });
  }

  /* -------------------------------------------- */

  /**
   * Handle spawning the TraitSelector application for selection various options.
   * @param {Event} event   The click event which originated the selection.
   * @private
   */
  _onConfigureTraits(event) {
    event.preventDefault();
    const a = event.currentTarget;
    const options = {
      name: a.dataset.target,
      title: a.parentElement.innerText,
      choices: [],
      allowCustom: false,
      suppressWarning: true,
    };
    switch (a.dataset.options) {
      case "saves":
        options.choices = CONFIG.SdS.abilities;
        options.valueKey = null;
        break;
      case "skills.choices":
        options.choices = CONFIG.SdS.skills;
        options.valueKey = null;
        options.labelKey = "label";
        break;
      case "skills":
        const skills = this.item.system.skills;
        const choices = skills.choices?.length
          ? skills.choices
          : Object.keys(CONFIG.SdS.skills);
        options.choices = Object.fromEntries(
          Object.entries(CONFIG.SdS.skills).filter(([s]) => choices.includes(s))
        );
        options.maximum = skills.number;
        options.labelKey = "label";
        break;
      case "tags":
        options.choices = CONFIG.SdS.spell_tags;
        options.valueKey = null;
        options.labelKey = "label";
        break;
      case "classes":
        options.choices = CONFIG.SdS.spellClasses;
        options.valueKey = null;
        break;
      case "schools":
        options.choices = CONFIG.SdS.spellSchools;
        options.valueKey = null;
        break;
      case "elements":
        options.choices = CONFIG.SdS.spellElements;
        options.valueKey = null;
        break;
    }
    new TraitSelector(this.item, options).render(true);
  }

  /* -------------------------------------------- */

  /**
   * Handle one of the advancement actions from the buttons or context menu.
   * @param {Element} target  Button or context menu entry that triggered this action.
   * @param {string} action   Action being triggered.
   * @returns {Promise|void}
   */
  _onAdvancementAction(target, action) {
    const id = target.closest(".advancement-item")?.dataset.id;
    const advancement = this.item.advancement.byId[id];
    let manager;
    if (["edit", "delete", "duplicate"].includes(action) && !advancement)
      return;
    switch (action) {
      case "add":
        return game.sds.applications.advancement.AdvancementSelection.createDialog(
          this.item
        );
      case "edit":
        return new advancement.constructor.metadata.apps.config(
          advancement
        ).render(true);
      case "delete":
        if (
          this.item.isEmbedded &&
          !game.settings.get("sds", "disableAdvancements")
        ) {
          manager = AdvancementManager.forDeletedAdvancement(
            this.item.actor,
            this.item.id,
            id
          );
          if (manager.steps.length) return manager.render(true);
        }
        return this.item.deleteAdvancement(id);
      case "duplicate":
        return this.item.duplicateAdvancement(id);
      case "modify-choices":
        const level = target.closest("li")?.dataset.level;
        manager = AdvancementManager.forModifyChoices(
          this.item.actor,
          this.item.id,
          Number(level)
        );
        if (manager.steps.length) manager.render(true);
        return;
      case "toggle-configuration":
        this.advancementConfigurationMode = !this.advancementConfigurationMode;
        return this.render();
    }
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async _onSubmit(...args) {
    if (this._tabs[0].active === "details") this.position.height = "auto";
    await super._onSubmit(...args);
  }
}

var _module$6 = /*#__PURE__*/ Object.freeze({
  __proto__: null,
  AbilityUseDialog: AbilityUseDialog,
  ItemSheet5e: ItemSheet5e,
});

/**
 * Pop out ProseMirror editor window for journal entries with multiple text areas that need editing.
 *
 * @param {JournalEntryPage} document   Journal entry page to be edited.
 * @param {object} options
 * @param {string} options.textKeyPath  The path to the specific HTML field being edited.
 */
class JournalEditor extends DocumentSheet {
  /** @inheritdoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["journal-editor"],
      template: "systems/sds/templates/journal/journal-editor.hbs",
      width: 520,
      height: 640,
      textKeyPath: null,
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  get title() {
    if (this.options.title)
      return `${this.document.name}: ${this.options.title}`;
    else return this.document.name;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async getData() {
    const data = super.getData();
    const rawText =
      foundry.utils.getProperty(this.document, this.options.textKeyPath) ?? "";
    return foundry.utils.mergeObject(data, {
      enriched: await TextEditor.enrichHTML(rawText, {
        relativeTo: this.document,
        secrets: this.document.isOwner,
        async: true,
      }),
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  _updateObject(event, formData) {
    this.document.update(formData);
  }
}

/**
 * Journal entry page that displays an automatically generated summary of a class along with additional description.
 */
class JournalClassPageSheet extends JournalPageSheet {
  /** @inheritdoc */
  static get defaultOptions() {
    const options = foundry.utils.mergeObject(super.defaultOptions, {
      dragDrop: [{ dropSelector: ".drop-target" }],
      submitOnChange: true,
    });
    options.classes.push("class-journal");
    return options;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  get template() {
    return `systems/sds/templates/journal/page-class-${
      this.isEditable ? "edit" : "view"
    }.hbs`;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  toc = {};

  /* -------------------------------------------- */

  /** @inheritdoc */
  async getData(options) {
    const context = super.getData(options);
    context.system = context.document.system;

    context.title = Object.fromEntries(
      Array.fromRange(4, 1).map((n) => [
        `level${n}`,
        context.data.title.level + n - 1,
      ])
    );

    const linked = await fromUuid(this.document.system.item);
    if (!linked) return context;
    context.linked = {
      document: linked,
      name: linked.name,
      lowercaseName: linked.name.toLowerCase(),
    };

    context.advancement = this._getAdvancement(linked);
    context.enriched = await this._getDescriptions(context.document);
    context.table = await this._getTable(linked);
    context.optionalTable = await this._getOptionalTable(linked);
    context.features = await this._getFeatures(linked);
    context.optionalFeatures = await this._getFeatures(linked, true);
    context.subclasses = await this._getSubclasses(
      this.document.system.subclassItems
    );
    context.subclasses?.sort((lhs, rhs) => lhs.name.localeCompare(rhs.name));

    return context;
  }

  /* -------------------------------------------- */

  /**
   * Prepare features granted by various advancement types.
   * @param {Item5e} item  Class item belonging to this journal.
   * @returns {object}     Prepared advancement section.
   */
  _getAdvancement(item) {
    const advancement = {};

    const hp = item.advancement.byType.HitPoints[0];
    if (hp) {
      advancement.hp = {
        hitDice: `1${hp.hitDie}`,
        max: hp.hitDieValue,
        average: Math.floor(hp.hitDieValue / 2) + 1,
      };
    }

    return advancement;
  }

  /* -------------------------------------------- */

  /**
   * Enrich all of the entries within the descriptions object on the sheet's system data.
   * @param {JournalEntryPage} page  Journal page being enriched.
   * @returns {Promise<object>}      Object with enriched descriptions.
   */
  async _getDescriptions(page) {
    const descriptions = await Promise.all(
      Object.entries(page.system.description ?? {}).map(async ([id, text]) => {
        const enriched = await TextEditor.enrichHTML(text, {
          relativeTo: this.object,
          secrets: this.object.isOwner,
          async: true,
        });
        return [id, enriched];
      })
    );
    return Object.fromEntries(descriptions);
  }

  /* -------------------------------------------- */

  /**
   * Prepare table based on non-optional GrantItem advancement & ScaleValue advancement.
   * @param {Item5e} item              Class item belonging to this journal.
   * @param {number} [initialLevel=1]  Level at which the table begins.
   * @returns {object}                 Prepared table.
   */
  async _getTable(item, initialLevel = 1) {
    const hasFeatures = !!item.advancement.byType.ItemGrant;
    const scaleValues = item.advancement.byType.ScaleValue ?? [];
    const spellProgression = await this._getSpellProgression(item);

    const headers = [[{ content: game.i18n.localize("SdS.Level") }]];
    if (item.type === "class")
      headers[0].push({
        content: game.i18n.localize("SdS.ProficiencyBonus"),
      });
    if (hasFeatures)
      headers[0].push({ content: game.i18n.localize("SdS.Features") });
    headers[0].push(...scaleValues.map((a) => ({ content: a.title })));
    if (spellProgression) {
      if (spellProgression.headers.length > 1) {
        headers[0].forEach((h) => (h.rowSpan = 2));
        headers[0].push(...spellProgression.headers[0]);
        headers[1] = spellProgression.headers[1];
      } else {
        headers[0].push(...spellProgression.headers[0]);
      }
    }

    const cols = [{ class: "level", span: 1 }];
    if (item.type === "class") cols.push({ class: "prof", span: 1 });
    if (hasFeatures) cols.push({ class: "features", span: 1 });
    if (scaleValues.length)
      cols.push({ class: "scale", span: scaleValues.length });
    if (spellProgression) cols.push(...spellProgression.cols);

    const makeLink = async (uuid) =>
      (await fromUuid(uuid))?.toAnchor({ classes: ["content-link"] }).outerHTML;

    const rows = [];
    for (const level of Array.fromRange(
      CONFIG.SdS.maxLevel - (initialLevel - 1),
      initialLevel
    )) {
      const features = [];
      for (const advancement of item.advancement.byLevel[level]) {
        switch (advancement.constructor.typeName) {
          case "ItemGrant":
            if (advancement.configuration.optional) continue;
            features.push(
              ...(await Promise.all(
                advancement.configuration.items.map(makeLink)
              ))
            );
            continue;
        }
      }

      // Level & proficiency bonus
      const cells = [{ class: "level", content: level.ordinalString() }];
      if (item.type === "class")
        cells.push({
          class: "prof",
          content: `+${Proficiency.calculateMod(level)}`,
        });
      if (hasFeatures)
        cells.push({ class: "features", content: features.join(", ") });
      scaleValues.forEach((s) =>
        cells.push({ class: "scale", content: s.valueForLevel(level)?.display })
      );
      const spellCells = spellProgression?.rows[rows.length];
      if (spellCells) cells.push(...spellCells);

      // Skip empty rows on subclasses
      if (
        item.type === "subclass" &&
        !features.length &&
        !scaleValues.length &&
        !spellCells
      )
        continue;

      rows.push(cells);
    }

    return { headers, cols, rows };
  }

  /* -------------------------------------------- */

  /**
   * Build out the spell progression data.
   * @param {Item5e} item  Class item belonging to this journal.
   * @returns {object}     Prepared spell progression table.
   */
  async _getSpellProgression(item) {
    const spellcasting = foundry.utils.deepClone(item.spellcasting);
    if (!spellcasting || spellcasting.progression === "none") return null;

    const table = { rows: [] };

    if (spellcasting.type === "leveled") {
      const spells = {};
      const maxSpellLevel =
        CONFIG.SdS.SPELL_SLOT_TABLE[CONFIG.SdS.SPELL_SLOT_TABLE.length - 1]
          .length;
      Array.fromRange(maxSpellLevel, 1).forEach(
        (l) => (spells[`spell${l}`] = {})
      );

      let largestSlot;
      for (const level of Array.fromRange(CONFIG.SdS.maxLevel, 1).reverse()) {
        const progression = { slot: 0 };
        spellcasting.levels = level;
        Actor5e.computeClassProgression(progression, item, { spellcasting });
        Actor5e.prepareSpellcastingSlots(spells, "leveled", progression);

        if (!largestSlot)
          largestSlot = Object.entries(spells).reduce((slot, [key, data]) => {
            if (!data.max) return slot;
            const level = parseInt(key.slice(5));
            if (!Number.isNaN(level) && level > slot) return level;
            return slot;
          }, -1);

        table.rows.push(
          Array.fromRange(largestSlot, 1).map((spellLevel) => {
            return {
              class: "spell-slots",
              content: spells[`spell${spellLevel}`]?.max || "&mdash;",
            };
          })
        );
      }

      // Prepare headers & columns
      table.headers = [
        [
          {
            content: game.i18n.localize(
              "JOURNALENTRYPAGE.SdS.Class.SpellSlotsPerSpellLevel"
            ),
            colSpan: largestSlot,
          },
        ],
        Array.fromRange(largestSlot, 1).map((spellLevel) => ({
          content: spellLevel.ordinalString(),
        })),
      ];
      table.cols = [{ class: "spellcasting", span: largestSlot }];
      table.rows.reverse();
    } else if (spellcasting.type === "pact") {
      const spells = { pact: {} };

      table.headers = [
        [
          {
            content: game.i18n.localize(
              "JOURNALENTRYPAGE.SdS.Class.SpellSlots"
            ),
          },
          {
            content: game.i18n.localize(
              "JOURNALENTRYPAGE.SdS.Class.SpellSlotLevel"
            ),
          },
        ],
      ];
      table.cols = [{ class: "spellcasting", span: 2 }];

      // Loop through each level, gathering "Spell Slots" & "Slot Level" for each one
      for (const level of Array.fromRange(CONFIG.SdS.maxLevel, 1)) {
        const progression = { pact: 0 };
        spellcasting.levels = level;
        Actor5e.computeClassProgression(progression, item, { spellcasting });
        Actor5e.prepareSpellcastingSlots(spells, "pact", progression);
        table.rows.push([
          { class: "spell-slots", content: `${spells.pact.max}` },
          { class: "slot-level", content: spells.pact.level.ordinalString() },
        ]);
      }
    } else {
      /**
       * A hook event that fires to generate the table for custom spellcasting types.
       * The actual hook names include the spellcasting type (e.g. `sds.buildPsionicSpellcastingTable`).
       * @param {object} table                          Table definition being built. *Will be mutated.*
       * @param {Item5e} item                           Class for which the spellcasting table is being built.
       * @param {SpellcastingDescription} spellcasting  Spellcasting descriptive object.
       * @function sds.buildSpellcastingTable
       * @memberof hookEvents
       */
      Hooks.callAll(
        `sds.build${spellcasting.type.capitalize()}SpellcastingTable`,
        table,
        item,
        spellcasting
      );
    }

    return table;
  }

  /* -------------------------------------------- */

  /**
   * Prepare options table based on optional GrantItem advancement.
   * @param {Item5e} item    Class item belonging to this journal.
   * @returns {object|null}  Prepared optional features table.
   */
  async _getOptionalTable(item) {
    const headers = [
      [
        { content: game.i18n.localize("SdS.Level") },
        { content: game.i18n.localize("SdS.Features") },
      ],
    ];

    const cols = [
      { class: "level", span: 1 },
      { class: "features", span: 1 },
    ];

    const makeLink = async (uuid) =>
      (await fromUuid(uuid))?.toAnchor({ classes: ["content-link"] }).outerHTML;

    const rows = [];
    for (const level of Array.fromRange(CONFIG.SdS.maxLevel, 1)) {
      const features = [];
      for (const advancement of item.advancement.byLevel[level]) {
        switch (advancement.constructor.typeName) {
          case "ItemGrant":
            if (!advancement.configuration.optional) continue;
            features.push(
              ...(await Promise.all(
                advancement.configuration.items.map(makeLink)
              ))
            );
            continue;
        }
      }
      if (!features.length) continue;

      // Level & proficiency bonus
      const cells = [
        { class: "level", content: level.ordinalString() },
        { class: "features", content: features.join(", ") },
      ];
      rows.push(cells);
    }
    if (!rows.length) return null;

    return { headers, cols, rows };
  }

  /* -------------------------------------------- */

  /**
   * Fetch data for each class feature listed.
   * @param {Item5e} item               Class or subclass item belonging to this journal.
   * @param {boolean} [optional=false]  Should optional features be fetched rather than required features?
   * @returns {object[]}   Prepared features.
   */
  async _getFeatures(item, optional = false) {
    const prepareFeature = async (uuid) => {
      const document = await fromUuid(uuid);
      return {
        document,
        name: document.name,
        description: await TextEditor.enrichHTML(
          document.system.description.value,
          {
            relativeTo: item,
            secrets: false,
            async: true,
          }
        ),
      };
    };

    let features = [];
    for (const advancement of item.advancement.byType.ItemGrant ?? []) {
      if (!!advancement.configuration.optional !== optional) continue;
      features.push(...advancement.configuration.items.map(prepareFeature));
    }
    features = await Promise.all(features);
    return features;
  }

  /* -------------------------------------------- */

  /**
   * Fetch each subclass and their features.
   * @param {string[]} uuids   UUIDs for the subclasses to fetch.
   * @returns {object[]|null}  Prepared subclasses.
   */
  async _getSubclasses(uuids) {
    const prepareSubclass = async (uuid) => {
      const document = await fromUuid(uuid);
      return this._getSubclass(document);
    };

    const subclasses = await Promise.all(uuids.map(prepareSubclass));
    return subclasses.length ? subclasses : null;
  }

  /* -------------------------------------------- */

  /**
   * Prepare data for the provided subclass.
   * @param {Item5e} item  Subclass item being prepared.
   * @returns {object}     Presentation data for this subclass.
   */
  async _getSubclass(item) {
    const initialLevel =
      Object.entries(item.advancement.byLevel).find(
        ([lvl, d]) => d.length
      )?.[0] ?? 1;
    return {
      document: item,
      name: item.name,
      description: await TextEditor.enrichHTML(item.system.description.value, {
        relativeTo: item,
        secrets: false,
        async: true,
      }),
      features: await this._getFeatures(item),
      table: await this._getTable(item, parseInt(initialLevel)),
    };
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @inheritdoc */
  async _renderInner(...args) {
    const html = await super._renderInner(...args);
    this.toc = JournalEntryPage.buildTOC(html.get());
    return html;
  }

  /* -------------------------------------------- */
  /*  Event Handlers                              */
  /* -------------------------------------------- */

  /** @inheritdoc */
  activateListeners(html) {
    super.activateListeners(html);
    html[0].querySelectorAll(".item-delete").forEach((e) => {
      e.addEventListener("click", this._onDeleteItem.bind(this));
    });
    html[0].querySelectorAll(".launch-text-editor").forEach((e) => {
      e.addEventListener("click", this._onLaunchTextEditor.bind(this));
    });
  }

  /* -------------------------------------------- */

  /**
   * Handle deleting a dropped item.
   * @param {Event} event  The triggering click event.
   * @returns {JournalClassSummary5ePageSheet}
   */
  async _onDeleteItem(event) {
    event.preventDefault();
    const container = event.currentTarget.closest("[data-item-uuid]");
    const uuidToDelete = container?.dataset.itemUuid;
    if (!uuidToDelete) return;
    switch (container.dataset.itemType) {
      case "class":
        await this.document.update({ "system.item": "" });
        return this.render();
      case "subclass":
        const itemSet = this.document.system.subclassItems;
        itemSet.delete(uuidToDelete);
        await this.document.update({
          "system.subclassItems": Array.from(itemSet),
        });
        return this.render();
    }
  }

  /* -------------------------------------------- */

  /**
   * Handle launching the individual text editing window.
   * @param {Event} event  The triggering click event.
   */
  _onLaunchTextEditor(event) {
    event.preventDefault();
    const textKeyPath = event.target.dataset.target;
    const label = event.target.closest(".form-group").querySelector("label");
    const editor = new JournalEditor(this.document, {
      textKeyPath,
      title: label?.innerText,
    });
    editor.render(true);
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async _onDrop(event) {
    const data = TextEditor.getDragEventData(event);

    if (data?.type !== "Item") return false;
    const item = await Item.implementation.fromDropData(data);
    switch (item.type) {
      case "class":
        await this.document.update({ "system.item": item.uuid });
        this.render();
      case "subclass":
        const itemSet = this.document.system.subclassItems;
        itemSet.add(item.uuid);
        await this.document.update({
          "system.subclassItems": Array.from(itemSet),
        });
        this.render();
      default:
        return false;
    }
  }
}

class SRDCompendium extends Compendium {
  /** @inheritdoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["srd-compendium"],
      template: "systems/sds/templates/journal/srd-compendium.hbs",
      width: 800,
      height: 950,
      resizable: true,
    });
  }

  /* -------------------------------------------- */

  /**
   * The IDs of some special pages that we use when configuring the display of the compendium.
   * @type {Object<string>}
   * @protected
   */
  static _SPECIAL_PAGES = {
    disclaimer: "xxt7YT2t76JxNTel",
    magicItemList: "sfJtvPjEs50Ruzi4",
    spellList: "plCB5ei1JbVtBseb",
  };

  /* -------------------------------------------- */

  /** @inheritdoc */
  async getData(options) {
    const data = await super.getData(options);
    const documents = await this.collection.getDocuments();
    const getOrder = (o) =>
      (({ chapter: 0, appendix: 100 }[o.flags?.sds?.type] ?? 200) +
      (o.flags?.sds?.position ?? 0));
    data.disclaimer = this.collection.get(
      this.constructor._SPECIAL_PAGES.disclaimer
    ).pages.contents[0].text.content;
    data.chapters = documents
      .reduce((arr, entry) => {
        const type = entry.getFlag("sds", "type");
        if (!type) return arr;
        const e = entry.toObject();
        e.showPages = e.pages.length > 1 && type === "chapter";
        arr.push(e);
        return arr;
      }, [])
      .sort((a, b) => getOrder(a) - getOrder(b));
    // Add spells A-Z to the end of Chapter 10.
    const spellList = this.collection.get(
      this.constructor._SPECIAL_PAGES.spellList
    );
    data.chapters[9].pages.push({
      _id: spellList.id,
      name: spellList.name,
      entry: true,
    });
    // Add magic items A-Z to the end of Chapter 11.
    const magicItemList = this.collection.get(
      this.constructor._SPECIAL_PAGES.magicItemList
    );
    data.chapters[10].pages.push({
      _id: magicItemList.id,
      name: magicItemList.name,
      entry: true,
    });
    return data;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  activateListeners(html) {
    super.activateListeners(html);
    html.find("a").on("click", this._onClickLink.bind(this));
  }

  /* -------------------------------------------- */

  /**
   * Handle clicking a link to a journal entry or page.
   * @param {MouseEvent} event  The triggering click event.
   * @protected
   */
  async _onClickLink(event) {
    const target = event.currentTarget;
    const entryId = target.closest("[data-entry-id]")?.dataset.entryId;
    const pageId = target.closest("[data-page-id]")?.dataset.pageId;
    if (!entryId) return;
    const options = {};
    if (pageId) options.pageId = pageId;
    const entry = await this.collection.getDocument(entryId);
    entry?.sheet.render(true, options);
  }
}

var _module$5 = /*#__PURE__*/ Object.freeze({
  __proto__: null,
  JournalClassPageSheet: JournalClassPageSheet,
  JournalEditor: JournalEditor,
  SRDCompendium: SRDCompendium,
});

/**
 * @deprecated since sds 2.1, targeted for removal in 2.3
 */
class DamageTraitSelector extends TraitSelector {
  /** @inheritdoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      template: "systems/sds/templates/apps/damage-trait-selector.hbs",
    });
  }

  /* -------------------------------------------- */

  /** @override */
  getData() {
    const data = super.getData();
    const attr = foundry.utils.getProperty(this.object, this.attribute);

    data.bypasses = Object.entries(this.options.bypasses).reduce(
      (obj, [k, v]) => {
        obj[k] = { label: v, chosen: attr ? attr.bypasses.includes(k) : false };
        return obj;
      },
      {}
    );

    return data;
  }

  /* -------------------------------------------- */

  /** @override */
  async _updateObject(event, formData) {
    const data = foundry.utils.expandObject(formData);
    const updateData = this._prepareUpdateData(data.choices);
    if (!updateData) return;
    updateData[`${this.attribute}.bypasses`] = Object.entries(data.bypasses)
      .filter(([, v]) => v)
      .map(([k]) => k);
    this.object.update(updateData);
  }
}

/**
 * An application for selecting proficiencies with categories that can contain children.
 * @deprecated since sds 2.1, targeted for removal in 2.3
 */
class ProficiencySelector extends TraitSelector {
  /** @inheritdoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      title: "Actor Proficiency Selection",
      type: "",
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async getData() {
    const attr = foundry.utils.getProperty(this.object, this.attribute);
    const chosen = this.options.valueKey
      ? foundry.utils.getProperty(attr, this.options.valueKey) ?? []
      : attr;

    const data = super.getData();
    data.choices = await choices(this.options.type, chosen);
    return data;
  }

  /* -------------------------------------------- */

  /**
   * A static helper method to get a list of choices for a proficiency type.
   *
   * @param {string} type               Proficiency type to select, either `armor`, `tool`, or `weapon`.
   * @param {string[]} [chosen]         Optional list of items to be marked as chosen.
   * @returns {Object<string, SelectChoices>}  Object mapping proficiency ids to choice objects.
   * @deprecated since sds 2.1, targeted for removal in 2.3
   */
  static async getChoices(type, chosen = []) {
    foundry.utils.logCompatibilityWarning(
      "ProficiencySelector#getChoices has been deprecated in favor of Trait#choices.",
      { since: "SdS 2.1", until: "SdS 2.3" }
    );
    return choices(type, chosen);
  }

  /* -------------------------------------------- */

  /**
   * Fetch an item for the provided ID. If the provided ID contains a compendium pack name
   * it will be fetched from that pack, otherwise it will be fetched from the compendium defined
   * in `SdS.sourcePacks.ITEMS`.
   *
   * @param {string} identifier            Simple ID or compendium name and ID separated by a dot.
   * @param {object} [options]
   * @param {boolean} [options.indexOnly]  If set to true, only the index data will be fetched (will never return
   *                                       Promise).
   * @param {boolean} [options.fullItem]   If set to true, the full item will be returned as long as `indexOnly` is
   *                                       false.
   * @returns {Promise<Item5e>|object}     Promise for a `Document` if `indexOnly` is false & `fullItem` is true,
   *                                       otherwise else a simple object containing the minimal index data.
   * @deprecated since sds 2.1, targeted for removal in 2.3
   */
  static getBaseItem(identifier, options) {
    foundry.utils.logCompatibilityWarning(
      "ProficiencySelector#getBaseItem has been deprecated in favor of Trait#getBaseItem.",
      { since: "SdS 2.1", until: "SdS 2.3" }
    );
    return getBaseItem(identifier, options);
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  activateListeners(html) {
    super.activateListeners(html);

    for (const checkbox of html[0].querySelectorAll("input[type='checkbox']")) {
      if (checkbox.checked) this._onToggleCategory(checkbox);
    }
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async _onChangeInput(event) {
    super._onChangeInput(event);

    if (event.target.tagName === "INPUT") this._onToggleCategory(event.target);
  }

  /* -------------------------------------------- */

  /**
   * Enable/disable all children when a category is checked.
   *
   * @param {HTMLElement} checkbox  Checkbox that was changed.
   * @private
   */
  _onToggleCategory(checkbox) {
    const children = checkbox.closest("li")?.querySelector("ol");
    if (!children) return;

    for (const child of children.querySelectorAll("input[type='checkbox']")) {
      child.checked = child.disabled = checkbox.checked;
    }
  }
}

var applications = /*#__PURE__*/ Object.freeze({
  __proto__: null,
  DamageTraitSelector: DamageTraitSelector,
  ProficiencySelector: ProficiencySelector,
  PropertyAttribution: PropertyAttribution,
  TraitSelector: TraitSelector,
  actor: _module$9,
  advancement: _module$8,
  combat: _module$7,
  item: _module$6,
  journal: _module$5,
});

/**
 * A helper class for building MeasuredTemplates for 5e spells and abilities
 */
class AbilityTemplate extends MeasuredTemplate {
  /**
   * Track the timestamp when the last mouse move event was captured.
   * @type {number}
   */
  #moveTime = 0;

  /* -------------------------------------------- */

  /**
   * The initially active CanvasLayer to re-activate after the workflow is complete.
   * @type {CanvasLayer}
   */
  #initialLayer;

  /* -------------------------------------------- */

  /**
   * Track the bound event handlers so they can be properly canceled later.
   * @type {object}
   */
  #events;

  /* -------------------------------------------- */

  /**
   * A factory method to create an AbilityTemplate instance using provided data from an Item5e instance
   * @param {Item5e} item               The Item object for which to construct the template
   * @returns {AbilityTemplate|null}    The template object, or null if the item does not produce a template
   */
  static fromItem(item) {
    const target = item.system.target ?? {};
    const templateShape = sds.config.areaTargetTypes[target.type]?.template;
    if (!templateShape) return null;

    // Prepare template data
    const templateData = {
      t: templateShape,
      user: game.user.id,
      distance: target.value,
      direction: 0,
      x: 0,
      y: 0,
      fillColor: game.user.color,
      flags: { sds: { origin: item.uuid } },
    };

    // Additional type-specific data
    switch (templateShape) {
      case "cone":
        templateData.angle = CONFIG.MeasuredTemplate.defaults.angle;
        break;
      case "rect": // 5e rectangular AoEs are always cubes
        templateData.distance = Math.hypot(target.value, target.value);
        templateData.width = target.value;
        templateData.direction = 45;
        break;
      case "ray": // 5e rays are most commonly 1 square (5 ft) in width
        templateData.width = target.width ?? canvas.dimensions.distance;
        break;
    }

    // Return the template constructed from the item data
    const cls = CONFIG.MeasuredTemplate.documentClass;
    const template = new cls(templateData, { parent: canvas.scene });
    const object = new this(template);
    object.item = item;
    object.actorSheet = item.actor?.sheet || null;
    return object;
  }

  /* -------------------------------------------- */

  /**
   * Creates a preview of the spell template.
   * @returns {Promise}  A promise that resolves with the final measured template if created.
   */
  drawPreview() {
    const initialLayer = canvas.activeLayer;

    // Draw the template and switch to the template layer
    this.draw();
    this.layer.activate();
    this.layer.preview.addChild(this);

    // Hide the sheet that originated the preview
    this.actorSheet?.minimize();

    // Activate interactivity
    return this.activatePreviewListeners(initialLayer);
  }

  /* -------------------------------------------- */

  /**
   * Activate listeners for the template preview
   * @param {CanvasLayer} initialLayer  The initially active CanvasLayer to re-activate after the workflow is complete
   * @returns {Promise}                 A promise that resolves with the final measured template if created.
   */
  activatePreviewListeners(initialLayer) {
    return new Promise((resolve, reject) => {
      this.#initialLayer = initialLayer;
      this.#events = {
        cancel: this._onCancelPlacement.bind(this),
        confirm: this._onConfirmPlacement.bind(this),
        move: this._onMovePlacement.bind(this),
        resolve,
        reject,
        rotate: this._onRotatePlacement.bind(this),
      };

      // Activate listeners
      canvas.stage.on("mousemove", this.#events.move);
      canvas.stage.on("mousedown", this.#events.confirm);
      canvas.app.view.oncontextmenu = this.#events.cancel;
      canvas.app.view.onwheel = this.#events.rotate;
    });
  }

  /* -------------------------------------------- */

  /**
   * Shared code for when template placement ends by being confirmed or canceled.
   * @param {Event} event  Triggering event that ended the placement.
   */
  async _finishPlacement(event) {
    this.layer._onDragLeftCancel(event);
    canvas.stage.off("mousemove", this.#events.move);
    canvas.stage.off("mousedown", this.#events.confirm);
    canvas.app.view.oncontextmenu = null;
    canvas.app.view.onwheel = null;
    this.#initialLayer.activate();
    await this.actorSheet?.maximize();
  }

  /* -------------------------------------------- */

  /**
   * Move the template preview when the mouse moves.
   * @param {Event} event  Triggering mouse event.
   */
  _onMovePlacement(event) {
    event.stopPropagation();
    const now = Date.now(); // Apply a 20ms throttle
    if (now - this.#moveTime <= 20) return;
    const center = event.data.getLocalPosition(this.layer);
    const interval = canvas.grid.type === CONST.GRID_TYPES.GRIDLESS ? 0 : 2;
    const snapped = canvas.grid.getSnappedPosition(
      center.x,
      center.y,
      interval
    );
    this.document.updateSource({ x: snapped.x, y: snapped.y });
    this.refresh();
    this.#moveTime = now;
  }

  /* -------------------------------------------- */

  /**
   * Rotate the template preview by 3˚ increments when the mouse wheel is rotated.
   * @param {Event} event  Triggering mouse event.
   */
  _onRotatePlacement(event) {
    if (event.ctrlKey) event.preventDefault(); // Avoid zooming the browser window
    event.stopPropagation();
    const delta = canvas.grid.type > CONST.GRID_TYPES.SQUARE ? 30 : 15;
    const snap = event.shiftKey ? delta : 5;
    const update = {
      direction: this.document.direction + snap * Math.sign(event.deltaY),
    };
    this.document.updateSource(update);
    this.refresh();
  }

  /* -------------------------------------------- */

  /**
   * Confirm placement when the left mouse button is clicked.
   * @param {Event} event  Triggering mouse event.
   */
  async _onConfirmPlacement(event) {
    await this._finishPlacement(event);
    const interval = canvas.grid.type === CONST.GRID_TYPES.GRIDLESS ? 0 : 2;
    const destination = canvas.grid.getSnappedPosition(
      this.document.x,
      this.document.y,
      interval
    );
    this.document.updateSource(destination);
    this.#events.resolve(
      canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [
        this.document.toObject(),
      ])
    );
  }

  /* -------------------------------------------- */

  /**
   * Cancel placement when the right mouse button is clicked.
   * @param {Event} event  Triggering mouse event.
   */
  async _onCancelPlacement(event) {
    await this._finishPlacement(event);
    this.#events.reject();
  }
}

/**
 * Extend the base Token class to implement additional system-specific logic.
 */
class Token5e extends Token {
  /** @inheritdoc */
  _drawBar(number, bar, data) {
    if (data.attribute === "attributes.hp")
      return this._drawHPBar(number, bar, data);
    return super._drawBar(number, bar, data);
  }

  /* -------------------------------------------- */

  /**
   * Specialized drawing function for HP bars.
   * @param {number} number      The Bar number
   * @param {PIXI.Graphics} bar  The Bar container
   * @param {object} data        Resource data for this bar
   * @private
   */
  _drawHPBar(number, bar, data) {
    // Extract health data
    let { value, max, temp, tempmax } =
      this.document.actor.system.attributes.hp;
    temp = Number(temp || 0);
    tempmax = Number(tempmax || 0);

    // Differentiate between effective maximum and displayed maximum
    const effectiveMax = Math.max(0, max + tempmax);
    let displayMax = max + (tempmax > 0 ? tempmax : 0);

    // Allocate percentages of the total
    const tempPct = Math.clamped(temp, 0, displayMax) / displayMax;
    const colorPct = Math.clamped(value, 0, effectiveMax) / displayMax;
    const hpColor = sds.documents.Actor5e.getHPColor(value, effectiveMax);

    // Determine colors to use
    const blk = 0x000000;
    const c = CONFIG.SdS.tokenHPColors;

    // Determine the container size (logic borrowed from core)
    const w = this.w;
    let h = Math.max(canvas.dimensions.size / 12, 8);
    if (this.document.height >= 2) h *= 1.6;
    const bs = Math.clamped(h / 8, 1, 2);
    const bs1 = bs + 1;

    // Overall bar container
    bar.clear();
    bar
      .beginFill(blk, 0.5)
      .lineStyle(bs, blk, 1.0)
      .drawRoundedRect(0, 0, w, h, 3);

    // Temporary maximum HP
    if (tempmax > 0) {
      const pct = max / effectiveMax;
      bar
        .beginFill(c.tempmax, 1.0)
        .lineStyle(1, blk, 1.0)
        .drawRoundedRect(pct * w, 0, (1 - pct) * w, h, 2);
    }

    // Maximum HP penalty
    else if (tempmax < 0) {
      const pct = (max + tempmax) / max;
      bar
        .beginFill(c.negmax, 1.0)
        .lineStyle(1, blk, 1.0)
        .drawRoundedRect(pct * w, 0, (1 - pct) * w, h, 2);
    }

    // Health bar
    bar
      .beginFill(hpColor, 1.0)
      .lineStyle(bs, blk, 1.0)
      .drawRoundedRect(0, 0, colorPct * w, h, 2);

    // Temporary hit points
    if (temp > 0) {
      bar
        .beginFill(c.temp, 1.0)
        .lineStyle(0)
        .drawRoundedRect(bs1, bs1, tempPct * w - 2 * bs1, h - 2 * bs1, 1);
    }

    // Set position
    let posY = number === 0 ? this.h - h : 0;
    bar.position.set(0, posY);
  }
}

/** @inheritDoc */
function measureDistances(segments, options = {}) {
  if (!options.gridSpaces)
    return BaseGrid.prototype.measureDistances.call(this, segments, options);

  // Track the total number of diagonals
  let nDiagonal = 0;
  const rule = this.parent.diagonalRule;
  const d = canvas.dimensions;

  // Iterate over measured segments
  return segments.map((s) => {
    let r = s.ray;

    // Determine the total distance traveled
    let nx = Math.abs(Math.ceil(r.dx / d.size));
    let ny = Math.abs(Math.ceil(r.dy / d.size));

    // Determine the number of straight and diagonal moves
    let nd = Math.min(nx, ny);
    let ns = Math.abs(ny - nx);
    nDiagonal += nd;

    // Alternative DMG Movement
    if (rule === "5105") {
      let nd10 = Math.floor(nDiagonal / 2) - Math.floor((nDiagonal - nd) / 2);
      let spaces = nd10 * 2 + (nd - nd10) + ns;
      return spaces * canvas.dimensions.distance;
    }

    // Euclidean Measurement
    else if (rule === "EUCL") {
      return Math.round(Math.hypot(nx, ny) * canvas.scene.grid.distance);
    }

    // Standard PHB Movement
    else return (ns + nd) * canvas.scene.grid.distance;
  });
}

var canvas$1 = /*#__PURE__*/ Object.freeze({
  __proto__: null,
  AbilityTemplate: AbilityTemplate,
  Token5e: Token5e,
  measureDistances: measureDistances,
});

/**
 * Data Model variant with some extra methods to support template mix-ins.
 *
 * **Note**: This uses some advanced Javascript techniques that are not necessary for most data models.
 * Please refer to the [advancement data models]{@link BaseAdvancement} for an example of a more typical usage.
 *
 * In template.json, each Actor or Item type can incorporate several templates which are chunks of data that are
 * common across all the types that use them. One way to represent them in the schema for a given Document type is to
 * duplicate schema definitions for the templates and write them directly into the Data Model for the Document type.
 * This works fine for small templates or systems that do not need many Document types but for more complex systems
 * this boilerplate can become prohibitive.
 *
 * Here we have opted to instead create a separate Data Model for each template available. These define their own
 * schemas which are then mixed-in to the final schema for the Document type's Data Model. A Document type Data Model
 * can define its own schema unique to it, and then add templates in direct correspondence to those in template.json
 * via SystemDataModel.mixin.
 */
class SystemDataModel extends foundry.abstract.DataModel {
  /** @inheritdoc */
  static _enableV10Validation = true;

  /**
   * System type that this system data model represents (e.g. "character", "npc", "vehicle").
   * @type {string}
   */
  static _systemType;

  /* -------------------------------------------- */

  /**
   * Base templates used for construction.
   * @type {*[]}
   * @private
   */
  static _schemaTemplates = [];

  /* -------------------------------------------- */

  /**
   * A list of properties that should not be mixed-in to the final type.
   * @type {Set<string>}
   * @private
   */
  static _immiscible = new Set([
    "length",
    "mixed",
    "name",
    "prototype",
    "migrateData",
    "defineSchema",
  ]);

  /* -------------------------------------------- */

  /** @inheritdoc */
  static defineSchema() {
    const schema = {};
    for (const template of this._schemaTemplates) {
      if (!template.defineSchema) {
        throw new Error(
          `Invalid sds template mixin ${template} defined on class ${this.constructor}`
        );
      }
      this.mergeSchema(schema, template.defineSchema());
    }
    return schema;
  }

  /* -------------------------------------------- */

  /**
   * Merge two schema definitions together as well as possible.
   * @param {DataSchema} a  First schema that forms the basis for the merge. *Will be mutated.*
   * @param {DataSchema} b  Second schema that will be merged in, overwriting any non-mergeable properties.
   * @returns {DataSchema}  Fully merged schema.
   */
  static mergeSchema(a, b) {
    Object.assign(a, b);
    return a;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static migrateData(source) {
    for (const template of this._schemaTemplates) {
      template.migrateData?.(source);
    }
    return super.migrateData(source);
  }

  /* -------------------------------------------- */

  /**
   * Mix multiple templates with the base type.
   * @param {...*} templates            Template classes to mix.
   * @returns {typeof SystemDataModel}  Final prepared type.
   */
  static mixin(...templates) {
    const Base = class extends this {};
    Object.defineProperty(Base, "_schemaTemplates", {
      value: Object.seal([...this._schemaTemplates, ...templates]),
      writable: false,
      configurable: false,
    });

    for (const template of templates) {
      // Take all static methods and fields from template and mix in to base class
      for (const [key, descriptor] of Object.entries(
        Object.getOwnPropertyDescriptors(template)
      )) {
        if (this._immiscible.has(key)) continue;
        Object.defineProperty(Base, key, descriptor);
      }

      // Take all instance methods and fields from template and mix in to base class
      for (const [key, descriptor] of Object.entries(
        Object.getOwnPropertyDescriptors(template.prototype)
      )) {
        if (["constructor"].includes(key)) continue;
        Object.defineProperty(Base.prototype, key, descriptor);
      }
    }

    return Base;
  }
}

/**
 * Shared contents of the attributes schema between various actor types.
 */
class AttributesFields {
  /**
   * Fields shared between characters, NPCs, and vehicles.
   *
   * @type {object}
   * @property {object} init
   * @property {number} init.value       Calculated initiative modifier.
   * @property {number} init.bonus       Fixed bonus provided to initiative rolls.
   * @property {object} movement
   * @property {number} movement.burrow  Actor burrowing speed.
   * @property {number} movement.climb   Actor climbing speed.
   * @property {number} movement.fly     Actor flying speed.
   * @property {number} movement.swim    Actor swimming speed.
   * @property {number} movement.walk    Actor walking speed.
   * @property {string} movement.units   Movement used to measure the various speeds.
   * @property {boolean} movement.hover  Is this flying creature able to hover in place.
   */
  static get common() {
    return {
      init: new foundry.data.fields.SchemaField(
        {
          ability: new foundry.data.fields.StringField({
            label: "SdS.AbilityModifier",
          }),
          bonus: new FormulaField({ label: "SdS.InitiativeBonus" }),
        },
        { label: "SdS.Initiative" }
      ),
      movement: new foundry.data.fields.SchemaField(
        {
          burrow: new foundry.data.fields.NumberField({
            nullable: false,
            min: 0,
            step: 0.1,
            initial: 0,
            label: "SdS.MovementBurrow",
          }),
          climb: new foundry.data.fields.NumberField({
            nullable: false,
            min: 0,
            step: 0.1,
            initial: 0,
            label: "SdS.MovementClimb",
          }),
          fly: new foundry.data.fields.NumberField({
            nullable: false,
            min: 0,
            step: 0.1,
            initial: 0,
            label: "SdS.MovementFly",
          }),
          swim: new foundry.data.fields.NumberField({
            nullable: false,
            min: 0,
            step: 0.1,
            initial: 0,
            label: "SdS.MovementSwim",
          }),
          walk: new foundry.data.fields.NumberField({
            nullable: false,
            min: 0,
            step: 0.1,
            initial: 30,
            label: "SdS.MovementWalk",
          }),
          units: new foundry.data.fields.StringField({
            initial: "ft",
            label: "SdS.MovementUnits",
          }),
          hover: new foundry.data.fields.BooleanField({
            label: "SdS.MovementHover",
          }),
        },
        { label: "SdS.Movement" }
      ),
    };
  }

  /* -------------------------------------------- */

  /**
   * Fields shared between characters and NPCs.
   *
   * @type {object}
   * @property {object} attunement
   * @property {number} attunement.max      Maximum number of attuned items.
   * @property {object} senses
   * @property {number} senses.darkvision   Creature's darkvision range.
   * @property {number} senses.blindsight   Creature's blindsight range.
   * @property {number} senses.tremorsense  Creature's tremorsense range.
   * @property {number} senses.truesight    Creature's truesight range.
   * @property {string} senses.units        Distance units used to measure senses.
   * @property {string} senses.special      Description of any special senses or restrictions.
   * @property {string} spellcasting        Primary spellcasting ability.
   */
  static get creature() {
    return {
      attunement: new foundry.data.fields.SchemaField(
        {
          max: new foundry.data.fields.NumberField({
            required: true,
            nullable: false,
            integer: true,
            min: 0,
            initial: 3,
            label: "SdS.AttunementMax",
          }),
        },
        { label: "SdS.Attunement" }
      ),
      senses: new foundry.data.fields.SchemaField(
        {
          darkvision: new foundry.data.fields.NumberField({
            required: true,
            nullable: false,
            integer: true,
            min: 0,
            initial: 0,
            label: "SdS.SenseDarkvision",
          }),
          blindsight: new foundry.data.fields.NumberField({
            required: true,
            nullable: false,
            integer: true,
            min: 0,
            initial: 0,
            label: "SdS.SenseBlindsight",
          }),
          tremorsense: new foundry.data.fields.NumberField({
            required: true,
            nullable: false,
            integer: true,
            min: 0,
            initial: 0,
            label: "SdS.SenseTremorsense",
          }),
          truesight: new foundry.data.fields.NumberField({
            required: true,
            nullable: false,
            integer: true,
            min: 0,
            initial: 0,
            label: "SdS.SenseTruesight",
          }),
          units: new foundry.data.fields.StringField({
            required: true,
            initial: "ft",
            label: "SdS.SenseUnits",
          }),
          special: new foundry.data.fields.StringField({
            required: true,
            label: "SdS.SenseSpecial",
          }),
        },
        { label: "SdS.Senses" }
      ),
      spellcasting: new foundry.data.fields.StringField({
        required: true,
        blank: true,
        initial: "int",
        label: "SdS.SpellAbility",
      }),
    };
  }

  /* -------------------------------------------- */

  /**
   * Migrate the old init.value and incorporate it into init.bonus.
   * @param {object} source  The source attributes object.
   * @internal
   */
  static _migrateInitiative(source) {
    const init = source?.init;
    if (!init?.value) return;
    if (init.bonus)
      init.bonus +=
        init.value < 0 ? ` - ${init.value * -1}` : ` + ${init.value}`;
    else init.bonus = `${init.value}`;
  }
}

/**
 * A template for currently held currencies.
 *
 * @property {object} currency  Object containing currencies as numbers.
 * @mixin
 */
class CurrencyTemplate extends foundry.abstract.DataModel {
  /** @inheritdoc */
  static defineSchema() {
    return {
      currency: new MappingField(
        new foundry.data.fields.NumberField({
          required: true,
          nullable: false,
          integer: true,
          min: 0,
          initial: 0,
        }),
        { initialKeys: CONFIG.SdS.currencies, label: "SdS.Currency" }
      ),
    };
  }
}

/**
 * @typedef {object} AbilityData
 * @property {number} value          Ability score.
 * @property {number} proficient     Proficiency value for saves.
 * @property {object} bonuses        Bonuses that modify ability checks and saves.
 * @property {string} bonuses.check  Numeric or dice bonus to ability checks.
 * @property {string} bonuses.save   Numeric or dice bonus to ability saving throws.
 */

/**
 * A template for all actors that share the common template.
 *
 * @property {Object<string, AbilityData>} abilities  Actor's abilities.
 * @mixin
 */
class CommonTemplate extends SystemDataModel.mixin(CurrencyTemplate) {
  /** @inheritdoc */
  static defineSchema() {
    return this.mergeSchema(super.defineSchema(), {
      abilities: new MappingField(
        new foundry.data.fields.SchemaField({
          value: new foundry.data.fields.NumberField({
            required: true,
            nullable: false,
            integer: true,
            min: 0,
            initial: 10,
            label: "SdS.AbilityScore",
          }),
          proficient: new foundry.data.fields.NumberField({
            required: true,
            initial: 0,
            label: "SdS.ProficiencyLevel",
          }),
          bonuses: new foundry.data.fields.SchemaField(
            {
              check: new FormulaField({
                required: true,
                label: "SdS.AbilityCheckBonus",
              }),
              save: new FormulaField({
                required: true,
                label: "SdS.SaveBonus",
              }),
            },
            { label: "SdS.AbilityBonuses" }
          ),
        }),
        { initialKeys: CONFIG.SdS.abilities, label: "SdS.Abilities" }
      ),
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static migrateData(source) {
    CommonTemplate.#migrateACData(source);
    CommonTemplate.#migrateMovementData(source);
  }

  /* -------------------------------------------- */

  /**
   * Migrate the actor ac.value to new ac.flat override field.
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migrateACData(source) {
    if (!source.attributes?.ac) return;
    const ac = source.attributes.ac;

    // If the actor has a numeric ac.value, then their AC has not been migrated to the auto-calculation schema yet.
    if (Number.isNumeric(ac.value)) {
      ac.flat = parseInt(ac.value);
      ac.calc = this._systemType === "npc" ? "natural" : "flat";
      return;
    }

    // Migrate ac.base in custom formulas to ac.armor
    if (
      typeof ac.formula === "string" &&
      ac.formula.includes("@attributes.ac.base")
    ) {
      ac.formula = ac.formula.replaceAll(
        "@attributes.ac.base",
        "@attributes.ac.armor"
      );
    }
  }

  /* -------------------------------------------- */

  /**
   * Migrate the actor speed string to movement object.
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migrateMovementData(source) {
    const original =
      source.attributes?.speed?.value ?? source.attributes?.speed;
    if (
      typeof original !== "string" ||
      source.attributes.movement?.walk !== undefined
    )
      return;
    source.attributes.movement ??= {};
    const s = original.split(" ");
    if (s.length > 0)
      source.attributes.movement.walk = Number.isNumeric(s[0])
        ? parseInt(s[0])
        : 0;
  }
}

/**
 * @typedef {object} SkillData
 * @property {number} value            Proficiency level creature has in this skill.
 * @property {string} ability          Default ability used for this skill.
 * @property {object} bonuses          Bonuses for this skill.
 * @property {string} bonuses.check    Numeric or dice bonus to skill's check.
 * @property {string} bonuses.passive  Numeric bonus to skill's passive check.
 */

/**
 * A template for all actors that are creatures
 *
 * @property {object} bonuses
 * @property {AttackBonusesData} bonuses.mwak        Bonuses to melee weapon attacks.
 * @property {AttackBonusesData} bonuses.rwak        Bonuses to ranged weapon attacks.
 * @property {AttackBonusesData} bonuses.msak        Bonuses to melee spell attacks.
 * @property {AttackBonusesData} bonuses.rsak        Bonuses to ranged spell attacks.
 * @property {object} bonuses.abilities              Bonuses to ability scores.
 * @property {string} bonuses.abilities.check        Numeric or dice bonus to ability checks.
 * @property {string} bonuses.abilities.save         Numeric or dice bonus to ability saves.
 * @property {string} bonuses.abilities.skill        Numeric or dice bonus to skill checks.
 * @property {object} bonuses.spell                  Bonuses to spells.
 * @property {string} bonuses.spell.dc               Numeric bonus to spellcasting DC.
 * @property {Object<string, SkillData>} skills      Actor's skills.
 * @property {Object<string, SpellSlotData>} spells  Actor's spell slots.
 */
class CreatureTemplate extends CommonTemplate {
  static defineSchema() {
    return this.mergeSchema(super.defineSchema(), {
      bonuses: new foundry.data.fields.SchemaField(
        {
          mwak: makeAttackBonuses({ label: "SdS.BonusMWAttack" }),
          rwak: makeAttackBonuses({ label: "SdS.BonusRWAttack" }),
          msak: makeAttackBonuses({ label: "SdS.BonusMSAttack" }),
          rsak: makeAttackBonuses({ label: "SdS.BonusRSAttack" }),
          abilities: new foundry.data.fields.SchemaField(
            {
              check: new FormulaField({
                required: true,
                label: "SdS.BonusAbilityCheck",
              }),
              save: new FormulaField({
                required: true,
                label: "SdS.BonusAbilitySave",
              }),
              skill: new FormulaField({
                required: true,
                label: "SdS.BonusAbilitySkill",
              }),
            },
            { label: "SdS.BonusAbility" }
          ),
          spell: new foundry.data.fields.SchemaField(
            {
              dc: new FormulaField({
                required: true,
                deterministic: true,
                label: "SdS.BonusSpellDC",
              }),
            },
            { label: "SdS.BonusSpell" }
          ),
        },
        { label: "SdS.Bonuses" }
      ),
      skills: new MappingField(
        new foundry.data.fields.SchemaField({
          value: new foundry.data.fields.NumberField({
            required: true,
            initial: 0,
            label: "SdS.ProficiencyLevel",
          }),
          ability: new foundry.data.fields.StringField({
            required: true,
            initial: "dex",
            label: "SdS.Ability",
          }),
          bonuses: new foundry.data.fields.SchemaField(
            {
              check: new FormulaField({
                required: true,
                label: "SdS.SkillBonusCheck",
              }),
              passive: new FormulaField({
                required: true,
                label: "SdS.SkillBonusPassive",
              }),
            },
            { label: "SdS.SkillBonuses" }
          ),
        }),
        {
          initialKeys: CONFIG.SdS.skills,
          initialValue: this._initialSkillValue,
        }
      ),
      spells: new MappingField(
        new foundry.data.fields.SchemaField({
          value: new foundry.data.fields.NumberField({
            nullable: false,
            integer: true,
            min: 0,
            initial: 0,
            label: "SdS.SpellProfAvailable",
          }),
          override: new foundry.data.fields.NumberField({
            integer: true,
            min: 0,
            label: "SdS.SpellProgOverride",
          }),
        }),
        { initialKeys: this._spellLevels, label: "SdS.SpellLevels" }
      ),
    });
  }

  /* -------------------------------------------- */

  /**
   * Populate the proper initial abilities for the skills.
   * @param {string} key      Key for which the initial data will be created.
   * @param {object} initial  The initial skill object created by SkillData.
   * @returns {object}        Initial skills object with the ability defined.
   * @private
   */
  static _initialSkillValue(key, initial) {
    if (CONFIG.SdS.skills[key]?.ability)
      initial.ability = CONFIG.SdS.skills[key].ability;
    return initial;
  }

  /* -------------------------------------------- */

  /**
   * Helper for building the default list of spell levels.
   * @type {string[]}
   * @private
   */
  static get _spellLevels() {
    const levels = Object.keys(CONFIG.SdS.spellLevels)
      .filter((a) => a !== "0")
      .map((l) => `spell${l}`);
    return [...levels, "pact"];
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static migrateData(source) {
    CreatureTemplate.#migrateSensesData(source);
  }

  /* -------------------------------------------- */

  /**
   * Migrate the actor traits.senses string to attributes.senses object.
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migrateSensesData(source) {
    const original = source.traits?.senses;
    if (original === undefined || typeof original !== "string") return;
    source.attributes ??= {};
    source.attributes.senses ??= {};

    // Try to match old senses with the format like "Darkvision 60 ft, Blindsight 30 ft"
    const pattern = /([A-z]+)\s?([0-9]+)\s?([A-z]+)?/;
    let wasMatched = false;

    // Match each comma-separated term
    for (let s of original.split(",")) {
      s = s.trim();
      const match = s.match(pattern);
      if (!match) continue;
      const type = match[1].toLowerCase();
      if (type in CONFIG.SdS.senses) {
        source.attributes.senses[type] = Number(match[2]).toNearest(0.5);
        wasMatched = true;
      }
    }

    // If nothing was matched, but there was an old string - put the whole thing in "special"
    if (!wasMatched && original) source.attributes.senses.special = original;
  }
}

/* -------------------------------------------- */

/**
 * Data on configuration of a specific spell slot.
 *
 * @typedef {object} SpellSlotData
 * @property {number} value     Currently available spell slots.
 * @property {number} override  Number to replace auto-calculated max slots.
 */

/* -------------------------------------------- */

/**
 * Data structure for actor's attack bonuses.
 *
 * @typedef {object} AttackBonusesData
 * @property {string} attack  Numeric or dice bonus to attack rolls.
 * @property {string} damage  Numeric or dice bonus to damage rolls.
 */

/**
 * Produce the schema field for a simple trait.
 * @param {object} schemaOptions  Options passed to the outer schema.
 * @returns {AttackBonusesData}
 */
function makeAttackBonuses(schemaOptions = {}) {
  return new foundry.data.fields.SchemaField(
    {
      attack: new FormulaField({ required: true, label: "SdS.BonusAttack" }),
      damage: new FormulaField({ required: true, label: "SdS.BonusDamage" }),
    },
    schemaOptions
  );
}

/**
 * Shared contents of the details schema between various actor types.
 */
class DetailsField {
  /**
   * Fields shared between characters, NPCs, and vehicles.
   *
   * @type {object}
   * @property {object} biography         Actor's biography data.
   * @property {string} biography.value   Full HTML biography information.
   * @property {string} biography.public  Biography that will be displayed to players with observer privileges.
   */
  static get common() {
    return {
      biography: new foundry.data.fields.SchemaField(
        {
          value: new foundry.data.fields.HTMLField({
            label: "SdS.Biography",
          }),
          public: new foundry.data.fields.HTMLField({
            label: "SdS.BiographyPublic",
          }),
        },
        { label: "SdS.Biography" }
      ),
    };
  }

  /* -------------------------------------------- */

  /**
   * Fields shared between characters and NPCs.
   *
   * @type {object}
   * @property {string} alignment  Creature's alignment.
   * @property {string} race       Creature's race.
   */
  static get creature() {
    return {
      alignment: new foundry.data.fields.StringField({
        required: true,
        label: "SdS.Alignment",
      }),
      race: new foundry.data.fields.StringField({
        required: true,
        label: "SdS.Race",
      }),
    };
  }
}

/**
 * Shared contents of the traits schema between various actor types.
 */
class TraitsField {
  /**
   * Data structure for a standard actor trait.
   *
   * @typedef {object} SimpleTraitData
   * @property {Set<string>} value  Keys for currently selected traits.
   * @property {string} custom      Semicolon-separated list of custom traits.
   */

  /**
   * Data structure for a damage actor trait.
   *
   * @typedef {object} DamageTraitData
   * @property {Set<string>} value     Keys for currently selected traits.
   * @property {Set<string>} bypasses  Keys for physical weapon properties that cause resistances to be bypassed.
   * @property {string} custom         Semicolon-separated list of custom traits.
   */

  /* -------------------------------------------- */

  /**
   * Fields shared between characters, NPCs, and vehicles.
   *
   * @type {object}
   * @property {string} size         Actor's size.
   * @property {DamageTraitData} di  Damage immunities.
   * @property {DamageTraitData} dr  Damage resistances.
   * @property {DamageTraitData} dv  Damage vulnerabilities.
   * @property {SimpleTraitData} ci  Condition immunities.
   */
  static get common() {
    return {
      size: new foundry.data.fields.StringField({
        required: true,
        initial: "med",
        label: "SdS.Size",
      }),
      di: this.makeDamageTrait({ label: "SdS.DamImm" }),
      dr: this.makeDamageTrait({ label: "SdS.DamRes" }),
      dv: this.makeDamageTrait({ label: "SdS.DamVuln" }),
      ci: this.makeSimpleTrait({ label: "SdS.ConImm" }),
    };
  }

  /* -------------------------------------------- */

  /**
   * Fields shared between characters and NPCs.
   *
   * @type {object}
   * @property {SimpleTraitData} languages  Languages known by this creature.
   */
  static get creature() {
    return {
      languages: this.makeSimpleTrait({ label: "SdS.Languages" }),
    };
  }

  /* -------------------------------------------- */

  /**
   * Produce the schema field for a simple trait.
   * @param {object} [schemaOptions={}]          Options passed to the outer schema.
   * @param {object} [options={}]
   * @param {string[]} [options.initial={}]      The initial value for the value set.
   * @param {object} [options.extraFields={}]    Additional fields added to schema.
   * @returns {SchemaField}
   */
  static makeSimpleTrait(
    schemaOptions = {},
    { initial = [], extraFields = {} } = {}
  ) {
    return new foundry.data.fields.SchemaField(
      {
        ...extraFields,
        value: new foundry.data.fields.SetField(
          new foundry.data.fields.StringField(),
          { label: "SdS.TraitsChosen", initial }
        ),
        custom: new foundry.data.fields.StringField({
          required: true,
          label: "SdS.Special",
        }),
      },
      schemaOptions
    );
  }

  /* -------------------------------------------- */

  /**
   * Produce the schema field for a damage trait.
   * @param {object} [schemaOptions={}]          Options passed to the outer schema.
   * @param {object} [options={}]
   * @param {string[]} [options.initial={}]      The initial value for the value set.
   * @param {object} [options.extraFields={}]    Additional fields added to schema.
   * @returns {SchemaField}
   */
  static makeDamageTrait(
    schemaOptions = {},
    { initial = [], initialBypasses = [], extraFields = {} } = {}
  ) {
    return this.makeSimpleTrait(schemaOptions, {
      initial,
      extraFields: {
        ...extraFields,
        bypasses: new foundry.data.fields.SetField(
          new foundry.data.fields.StringField(),
          {
            label: "SdS.DamagePhysicalBypass",
            hint: "SdS.DamagePhysicalBypassHint",
            initial: initialBypasses,
          }
        ),
      },
    });
  }
}

/**
 * System data definition for Characters.
 *
 * @property {object} attributes
 * @property {object} attributes.ac
 * @property {number} attributes.ac.flat                  Flat value used for flat or natural armor calculation.
 * @property {string} attributes.ac.calc                  Name of one of the built-in formulas to use.
 * @property {string} attributes.ac.formula               Custom formula to use.
 * @property {object} attributes.hp
 * @property {number} attributes.hp.value                 Current hit points.
 * @property {number} attributes.hp.max                   Override for maximum HP.
 * @property {number} attributes.hp.temp                  Temporary HP applied on top of value.
 * @property {number} attributes.hp.tempmax               Temporary change to the maximum HP.
 * @property {object} attributes.hp.bonuses
 * @property {string} attributes.hp.bonuses.level         Bonus formula applied for each class level.
 * @property {string} attributes.hp.bonuses.overall       Bonus formula applied to total HP.
 * @property {object} attributes.death
 * @property {number} attributes.death.success            Number of successful death saves.
 * @property {number} attributes.death.failure            Number of failed death saves.
 * @property {number} attributes.exhaustion               Number of levels of exhaustion.
 * @property {number} attributes.inspiration              Does this character have inspiration?
 * @property {object} details
 * @property {string} details.background                  Name of character's background.
 * @property {string} details.originalClass               ID of first class taken by character.
 * @property {XPData} details.xp                          Experience points gained.
 * @property {number} details.xp.value                    Total experience points earned.
 * @property {string} details.appearance                  Description of character's appearance.
 * @property {string} details.trait                       Character's personality traits.
 * @property {string} details.ideal                       Character's ideals.
 * @property {string} details.bond                        Character's bonds.
 * @property {string} details.flaw                        Character's flaws.
 * @property {object} traits
 * @property {SimpleTraitData} traits.weaponProf          Character's weapon proficiencies.
 * @property {SimpleTraitData} traits.armorProf           Character's armor proficiencies.
 * @property {SimpleTraitData} traits.toolProf            Character's tool proficiencies.
 * @property {object} resources
 * @property {CharacterResourceData} resources.primary    Resource number one.
 * @property {CharacterResourceData} resources.secondary  Resource number two.
 * @property {CharacterResourceData} resources.tertiary   Resource number three.
 */
class CharacterData extends CreatureTemplate {
  /** @inheritdoc */
  static _systemType = "character";

  /* -------------------------------------------- */

  /** @inheritdoc */
  static defineSchema() {
    return this.mergeSchema(super.defineSchema(), {
      attributes: new foundry.data.fields.SchemaField(
        {
          ...AttributesFields.common,
          ...AttributesFields.creature,
          ac: new foundry.data.fields.SchemaField(
            {
              flat: new foundry.data.fields.NumberField({
                integer: true,
                min: 0,
                label: "SdS.ArmorClassFlat",
              }),
              calc: new foundry.data.fields.StringField({
                initial: "default",
                label: "SdS.ArmorClassCalculation",
              }),
              formula: new FormulaField({
                deterministic: true,
                label: "SdS.ArmorClassFormula",
              }),
            },
            { label: "SdS.ArmorClass" }
          ),
          hp: new foundry.data.fields.SchemaField(
            {
              value: new foundry.data.fields.NumberField({
                nullable: false,
                integer: true,
                min: 0,
                initial: 0,
                label: "SdS.HitPointsCurrent",
              }),
              max: new foundry.data.fields.NumberField({
                nullable: true,
                integer: true,
                min: 0,
                initial: null,
                label: "SdS.HitPointsOverride",
              }),
              temp: new foundry.data.fields.NumberField({
                integer: true,
                initial: 0,
                min: 0,
                label: "SdS.HitPointsTemp",
              }),
              tempmax: new foundry.data.fields.NumberField({
                integer: true,
                initial: 0,
                label: "SdS.HitPointsTempMax",
              }),
              bonuses: new foundry.data.fields.SchemaField({
                level: new FormulaField({
                  deterministic: true,
                  label: "SdS.HitPointsBonusLevel",
                }),
                overall: new FormulaField({
                  deterministic: true,
                  label: "SdS.HitPointsBonusOverall",
                }),
              }),
            },
            { label: "SdS.HitPoints" }
          ),
          mana: new foundry.data.fields.SchemaField(
            {
              value: new foundry.data.fields.NumberField({
                nullable: false,
                integer: true,
                min: 0,
                initial: 0,
                label: "SdS.ManaPointsCurrent",
              }),
              max: new foundry.data.fields.NumberField({
                nullable: true,
                integer: true,
                min: 0,
                initial: null,
                label: "SdS.ManaPointsOverride",
              }),
              temp: new foundry.data.fields.NumberField({
                integer: true,
                initial: 0,
                min: 0,
                label: "SdS.ManaPointsTemp",
              }),
              tempmax: new foundry.data.fields.NumberField({
                integer: true,
                initial: 0,
                label: "SdS.ManaPointsTempMax",
              }),
              bonuses: new foundry.data.fields.SchemaField({
                level: new FormulaField({
                  deterministic: true,
                  label: "SdS.ManaPointsBonusLevel",
                }),
                overall: new FormulaField({
                  deterministic: true,
                  label: "SdS.ManaPointsBonusOverall",
                }),
              }),
            },
            { label: "SdS.Mana" }
          ),
          death: new foundry.data.fields.SchemaField(
            {
              success: new foundry.data.fields.NumberField({
                required: true,
                nullable: false,
                integer: true,
                min: 0,
                initial: 0,
                label: "SdS.DeathSaveSuccesses",
              }),
              failure: new foundry.data.fields.NumberField({
                required: true,
                nullable: false,
                integer: true,
                min: 0,
                initial: 0,
                label: "SdS.DeathSaveFailures",
              }),
            },
            { label: "SdS.DeathSave" }
          ),
          exhaustion: new foundry.data.fields.NumberField({
            required: true,
            nullable: false,
            integer: true,
            min: 0,
            initial: 0,
            label: "SdS.Exhaustion",
          }),
          inspiration: new foundry.data.fields.BooleanField({
            required: true,
            label: "SdS.Inspiration",
          }),
        },
        { label: "SdS.Attributes" }
      ),
      details: new foundry.data.fields.SchemaField(
        {
          ...DetailsField.common,
          ...DetailsField.creature,
          background: new foundry.data.fields.StringField({
            required: true,
            label: "SdS.Background",
          }),
          originalClass: new foundry.data.fields.StringField({
            required: true,
            label: "SdS.ClassOriginal",
          }),
          xp: new foundry.data.fields.SchemaField(
            {
              value: new foundry.data.fields.NumberField({
                required: true,
                nullable: false,
                integer: true,
                min: 0,
                initial: 0,
                label: "SdS.ExperiencePointsCurrent",
              }),
            },
            { label: "SdS.ExperiencePoints" }
          ),
          appearance: new foundry.data.fields.StringField({
            required: true,
            label: "SdS.Appearance",
          }),
          trait: new foundry.data.fields.StringField({
            required: true,
            label: "SdS.PersonalityTraits",
          }),
          ideal: new foundry.data.fields.StringField({
            required: true,
            label: "SdS.Ideals",
          }),
          bond: new foundry.data.fields.StringField({
            required: true,
            label: "SdS.Bonds",
          }),
          flaw: new foundry.data.fields.StringField({
            required: true,
            label: "SdS.Flaws",
          }),
        },
        { label: "SdS.Details" }
      ),
      traits: new foundry.data.fields.SchemaField(
        {
          ...TraitsField.common,
          ...TraitsField.creature,
          weaponProf: TraitsField.makeSimpleTrait({
            label: "SdS.TraitWeaponProf",
          }),
          armorProf: TraitsField.makeSimpleTrait({
            label: "SdS.TraitArmorProf",
          }),
          toolProf: TraitsField.makeSimpleTrait({
            label: "SdS.TraitToolProf",
          }),
        },
        { label: "SdS.Traits" }
      ),
      resources: new foundry.data.fields.SchemaField(
        {
          primary: makeResourceField({ label: "SdS.ResourcePrimary" }),
          secondary: makeResourceField({ label: "SdS.ResourceSecondary" }),
          tertiary: makeResourceField({ label: "SdS.ResourceTertiary" }),
        },
        { label: "SdS.Resources" }
      ),
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static migrateData(source) {
    super.migrateData(source);
    AttributesFields._migrateInitiative(source.attributes);
  }
}

/* -------------------------------------------- */

/**
 * Data structure for character's resources.
 *
 * @typedef {object} ResourceData
 * @property {number} value  Available uses of this resource.
 * @property {number} max    Maximum allowed uses of this resource.
 * @property {boolean} sr    Does this resource recover on a short rest?
 * @property {boolean} lr    Does this resource recover on a long rest?
 * @property {string} label  Displayed name.
 */

/**
 * Produce the schema field for a simple trait.
 * @param {object} schemaOptions  Options passed to the outer schema.
 * @returns {ResourceData}
 */
function makeResourceField(schemaOptions = {}) {
  return new foundry.data.fields.SchemaField(
    {
      value: new foundry.data.fields.NumberField({
        required: true,
        integer: true,
        initial: 0,
        labels: "SdS.ResourceValue",
      }),
      max: new foundry.data.fields.NumberField({
        required: true,
        integer: true,
        initial: 0,
        labels: "SdS.ResourceMax",
      }),
      sr: new foundry.data.fields.BooleanField({
        required: true,
        labels: "SdS.ShortRestRecovery",
      }),
      lr: new foundry.data.fields.BooleanField({
        required: true,
        labels: "SdS.LongRestRecovery",
      }),
      label: new foundry.data.fields.StringField({
        required: true,
        labels: "SdS.ResourceLabel",
      }),
    },
    schemaOptions
  );
}

/**
 * A data model and API layer which handles the schema and functionality of "group" type Actors in the sds system.
 * @mixes CurrencyTemplate
 *
 * @property {object} description
 * @property {string} description.full           Description of this group.
 * @property {string} description.summary        Summary description (currently unused).
 * @property {Set<string>} members               IDs of actors belonging to this group in the world collection.
 * @property {object} attributes
 * @property {object} attributes.movement
 * @property {number} attributes.movement.land   Base movement speed over land.
 * @property {number} attributes.movement.water  Base movement speed over water.
 * @property {number} attributes.movement.air    Base movement speed through the air.
 *
 * @example Create a new Group
 * const g = new sds.documents.Actor5e({
 *  type: "group",
 *  name: "Test Group",
 *  system: {
 *    members: ["3f3hoYFWUgDqBP4U"]
 *  }
 * });
 */
class GroupActor extends SystemDataModel.mixin(CurrencyTemplate) {
  /** @inheritdoc */
  static defineSchema() {
    return this.mergeSchema(super.defineSchema(), {
      description: new foundry.data.fields.SchemaField({
        full: new foundry.data.fields.HTMLField({ label: "SdS.Description" }),
        summary: new foundry.data.fields.HTMLField({
          label: "SdS.DescriptionSummary",
        }),
      }),
      members: new foundry.data.fields.SetField(
        new foundry.data.fields.ForeignDocumentField(
          foundry.documents.BaseActor,
          { idOnly: true }
        ),
        { label: "SdS.GroupMembers" }
      ),
      attributes: new foundry.data.fields.SchemaField(
        {
          movement: new foundry.data.fields.SchemaField({
            land: new foundry.data.fields.NumberField({
              nullable: false,
              min: 0,
              step: 0.1,
              initial: 0,
              label: "SdS.MovementLand",
            }),
            water: new foundry.data.fields.NumberField({
              nullable: false,
              min: 0,
              step: 0.1,
              initial: 0,
              label: "SdS.MovementWater",
            }),
            air: new foundry.data.fields.NumberField({
              nullable: false,
              min: 0,
              step: 0.1,
              initial: 0,
              label: "SdS.MovementAir",
            }),
          }),
        },
        { label: "SdS.Attributes" }
      ),
    });
  }

  /* -------------------------------------------- */
  /*  Data Preparation                            */
  /* -------------------------------------------- */

  /**
   * Prepare base data for group actors.
   * @internal
   */
  _prepareBaseData() {
    this.members.clear();
    for (const id of this._source.members) {
      const a = game.actors.get(id);
      if (a) {
        if (a.type === "group") {
          console.warn(
            `Group "${this._id}" may not contain another Group "${a.id}" as a member.`
          );
        } else this.members.add(a);
      } else
        console.warn(
          `Actor "${id}" in group "${this._id}" does not exist within the World.`
        );
    }
  }

  /**
   * Prepare derived data for group actors.
   * @internal
   */
  _prepareDerivedData() {
    // No preparation needed at this time
  }

  /* -------------------------------------------- */
  /*  Methods                                     */
  /* -------------------------------------------- */

  /**
   * Add a new member to the group.
   * @param {Actor5e} actor           A non-group Actor to add to the group
   * @returns {Promise<Actor5e>}      The updated group Actor
   */
  async addMember(actor) {
    if (actor.type === "group")
      throw new Error("You may not add a group within a group.");
    if (actor.pack)
      throw new Error(
        "You may only add Actors to the group which exist within the World."
      );
    const memberIds = this._source.members;
    if (memberIds.includes(actor.id)) return;
    return this.parent.update({
      system: {
        members: memberIds.concat([actor.id]),
      },
    });
  }

  /* -------------------------------------------- */

  /**
   * Remove a member from the group.
   * @param {Actor5e|string} actor    An Actor or ID to remove from this group
   * @returns {Promise<Actor5e>}      The updated group Actor
   */
  async removeMember(actor) {
    const memberIds = foundry.utils.deepClone(this._source.members);

    // Handle user input
    let actorId;
    if (typeof actor === "string") actorId = actor;
    else if (actor instanceof Actor) actorId = actor.id;
    else
      throw new Error(
        "You must provide an Actor document or an actor ID to remove a group member"
      );
    if (!memberIds.includes(actorId))
      throw new Error(`Actor id "${actorId}" is not a group member`);

    // Remove the actor and update the parent document
    memberIds.findSplice((id) => id === actorId);
    return this.parent.update({
      system: {
        members: memberIds,
      },
    });
  }
}

/**
 * System data definition for NPCs.
 *
 * @property {object} attributes
 * @property {object} attributes.ac
 * @property {number} attributes.ac.flat         Flat value used for flat or natural armor calculation.
 * @property {string} attributes.ac.calc         Name of one of the built-in formulas to use.
 * @property {string} attributes.ac.formula      Custom formula to use.
 * @property {object} attributes.hp
 * @property {number} attributes.hp.value        Current hit points.
 * @property {number} attributes.hp.max          Maximum allowed HP value.
 * @property {number} attributes.hp.temp         Temporary HP applied on top of value.
 * @property {number} attributes.hp.tempmax      Temporary change to the maximum HP.
 * @property {string} attributes.hp.formula      Formula used to determine hit points.
 * @property {object} details
 * @property {TypeData} details.type             Creature type of this NPC.
 * @property {string} details.type.value         NPC's type as defined in the system configuration.
 * @property {string} details.type.subtype       NPC's subtype usually displayed in parenthesis after main type.
 * @property {string} details.type.swarm         Size of the individual creatures in a swarm, if a swarm.
 * @property {string} details.type.custom        Custom type beyond what is available in the configuration.
 * @property {string} details.environment        Common environments in which this NPC is found.
 * @property {number} details.cr                 NPC's challenge rating.
 * @property {number} details.spellLevel         Spellcasting level of this NPC.
 * @property {string} details.source             What book or adventure is this NPC from?
 * @property {object} resources
 * @property {object} resources.legact           NPC's legendary actions.
 * @property {number} resources.legact.value     Currently available legendary actions.
 * @property {number} resources.legact.max       Maximum number of legendary actions.
 * @property {object} resources.legres           NPC's legendary resistances.
 * @property {number} resources.legres.value     Currently available legendary resistances.
 * @property {number} resources.legres.max       Maximum number of legendary resistances.
 * @property {object} resources.lair             NPC's lair actions.
 * @property {boolean} resources.lair.value      Does this NPC use lair actions.
 * @property {number} resources.lair.initiative  Initiative count when lair actions are triggered.
 */
class NPCData extends CreatureTemplate {
  /** @inheritdoc */
  static _systemType = "npc";

  /* -------------------------------------------- */

  /** @inheritdoc */
  static defineSchema() {
    return this.mergeSchema(super.defineSchema(), {
      attributes: new foundry.data.fields.SchemaField(
        {
          ...AttributesFields.common,
          ...AttributesFields.creature,
          ac: new foundry.data.fields.SchemaField(
            {
              flat: new foundry.data.fields.NumberField({
                integer: true,
                min: 0,
                label: "SdS.ArmorClassFlat",
              }),
              calc: new foundry.data.fields.StringField({
                initial: "default",
                label: "SdS.ArmorClassCalculation",
              }),
              formula: new FormulaField({
                deterministic: true,
                label: "SdS.ArmorClassFormula",
              }),
            },
            { label: "SdS.ArmorClass" }
          ),
          hp: new foundry.data.fields.SchemaField(
            {
              value: new foundry.data.fields.NumberField({
                nullable: false,
                integer: true,
                min: 0,
                initial: 10,
                label: "SdS.HitPointsCurrent",
              }),
              max: new foundry.data.fields.NumberField({
                nullable: false,
                integer: true,
                min: 0,
                initial: 10,
                label: "SdS.HitPointsMax",
              }),
              temp: new foundry.data.fields.NumberField({
                integer: true,
                initial: 0,
                min: 0,
                label: "SdS.HitPointsTemp",
              }),
              tempmax: new foundry.data.fields.NumberField({
                integer: true,
                initial: 0,
                label: "SdS.HitPointsTempMax",
              }),
              formula: new FormulaField({
                required: true,
                label: "SdS.HPFormula",
              }),
            },
            { label: "SdS.HitPoints" }
          ),
        },
        { label: "SdS.Attributes" }
      ),
      details: new foundry.data.fields.SchemaField(
        {
          ...DetailsField.common,
          ...DetailsField.creature,
          type: new foundry.data.fields.SchemaField(
            {
              value: new foundry.data.fields.StringField({
                required: true,
                blank: true,
                label: "SdS.CreatureType",
              }),
              subtype: new foundry.data.fields.StringField({
                required: true,
                label: "SdS.CreatureTypeSelectorSubtype",
              }),
              swarm: new foundry.data.fields.StringField({
                required: true,
                blank: true,
                label: "SdS.CreatureSwarmSize",
              }),
              custom: new foundry.data.fields.StringField({
                required: true,
                label: "SdS.CreatureTypeSelectorCustom",
              }),
            },
            { label: "SdS.CreatureType" }
          ),
          environment: new foundry.data.fields.StringField({
            required: true,
            label: "SdS.Environment",
          }),
          cr: new foundry.data.fields.NumberField({
            required: true,
            nullable: false,
            min: 0,
            initial: 1,
            label: "SdS.ChallengeRating",
          }),
          spellLevel: new foundry.data.fields.NumberField({
            required: true,
            nullable: false,
            integer: true,
            min: 0,
            initial: 0,
            label: "SdS.SpellcasterLevel",
          }),
          source: new foundry.data.fields.StringField({
            required: true,
            label: "SdS.Source",
          }),
        },
        { label: "SdS.Details" }
      ),
      resources: new foundry.data.fields.SchemaField(
        {
          legact: new foundry.data.fields.SchemaField(
            {
              value: new foundry.data.fields.NumberField({
                required: true,
                nullable: false,
                integer: true,
                min: 0,
                initial: 0,
                label: "SdS.LegActRemaining",
              }),
              max: new foundry.data.fields.NumberField({
                required: true,
                nullable: false,
                integer: true,
                min: 0,
                initial: 0,
                label: "SdS.LegActMax",
              }),
            },
            { label: "SdS.LegAct" }
          ),
          legres: new foundry.data.fields.SchemaField(
            {
              value: new foundry.data.fields.NumberField({
                required: true,
                nullable: false,
                integer: true,
                min: 0,
                initial: 0,
                label: "SdS.LegResRemaining",
              }),
              max: new foundry.data.fields.NumberField({
                required: true,
                nullable: false,
                integer: true,
                min: 0,
                initial: 0,
                label: "SdS.LegResMax",
              }),
            },
            { label: "SdS.LegRes" }
          ),
          lair: new foundry.data.fields.SchemaField(
            {
              value: new foundry.data.fields.BooleanField({
                required: true,
                label: "SdS.LairAct",
              }),
              initiative: new foundry.data.fields.NumberField({
                required: true,
                integer: true,
                label: "SdS.LairActionInitiative",
              }),
            },
            { label: "SdS.LairActionLabel" }
          ),
        },
        { label: "SdS.Resources" }
      ),
      traits: new foundry.data.fields.SchemaField(
        {
          ...TraitsField.common,
          ...TraitsField.creature,
        },
        { label: "SdS.Traits" }
      ),
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static migrateData(source) {
    super.migrateData(source);
    NPCData.#migrateTypeData(source);
    AttributesFields._migrateInitiative(source.attributes);
  }

  /* -------------------------------------------- */

  /**
   * Migrate the actor type string to type object.
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migrateTypeData(source) {
    const original = source.type;
    if (typeof original !== "string") return;

    source.type = {
      value: "",
      subtype: "",
      swarm: "",
      custom: "",
    };

    // Match the existing string
    const pattern =
      /^(?:swarm of (?<size>[\w-]+) )?(?<type>[^(]+?)(?:\((?<subtype>[^)]+)\))?$/i;
    const match = original.trim().match(pattern);
    if (match) {
      // Match a known creature type
      const typeLc = match.groups.type.trim().toLowerCase();
      const typeMatch = Object.entries(CONFIG.SdS.creatureTypes).find(
        ([k, v]) => {
          return (
            typeLc === k ||
            typeLc === game.i18n.localize(v).toLowerCase() ||
            typeLc === game.i18n.localize(`${v}Pl`).toLowerCase()
          );
        }
      );
      if (typeMatch) source.type.value = typeMatch[0];
      else {
        source.type.value = "custom";
        source.type.custom = match.groups.type.trim().titleCase();
      }
      source.type.subtype = match.groups.subtype?.trim().titleCase() ?? "";

      // Match a swarm
      if (match.groups.size) {
        const sizeLc = match.groups.size
          ? match.groups.size.trim().toLowerCase()
          : "tiny";
        const sizeMatch = Object.entries(CONFIG.SdS.actorSizes).find(
          ([k, v]) => {
            return (
              sizeLc === k || sizeLc === game.i18n.localize(v).toLowerCase()
            );
          }
        );
        source.type.swarm = sizeMatch ? sizeMatch[0] : "tiny";
      } else source.type.swarm = "";
    }

    // No match found
    else {
      source.type.value = "custom";
      source.type.custom = original;
    }
  }
}

/**
 * System data definition for Vehicles.
 *
 * @property {string} vehicleType                      Type of vehicle as defined in `SdS.vehicleTypes`.
 * @property {object} attributes
 * @property {object} attributes.ac
 * @property {number} attributes.ac.flat               Flat value used for flat or natural armor calculation.
 * @property {string} attributes.ac.calc               Name of one of the built-in formulas to use.
 * @property {string} attributes.ac.formula            Custom formula to use.
 * @property {string} attributes.ac.motionless         Changes to vehicle AC when not moving.
 * @property {object} attributes.hp
 * @property {number} attributes.hp.value              Current hit points.
 * @property {number} attributes.hp.max                Maximum allowed HP value.
 * @property {number} attributes.hp.temp               Temporary HP applied on top of value.
 * @property {number} attributes.hp.tempmax            Temporary change to the maximum HP.
 * @property {number} attributes.hp.dt                 Damage threshold.
 * @property {number} attributes.hp.mt                 Mishap threshold.
 * @property {object} attributes.actions               Information on how the vehicle performs actions.
 * @property {boolean} attributes.actions.stations     Does this vehicle rely on action stations that required
 *                                                     individual crewing rather than general crew thresholds?
 * @property {number} attributes.actions.value         Maximum number of actions available with full crewing.
 * @property {object} attributes.actions.thresholds    Crew thresholds needed to perform various actions.
 * @property {number} attributes.actions.thresholds.2  Minimum crew needed to take full action complement.
 * @property {number} attributes.actions.thresholds.1  Minimum crew needed to take reduced action complement.
 * @property {number} attributes.actions.thresholds.0  Minimum crew needed to perform any actions.
 * @property {object} attributes.capacity              Information on the vehicle's carrying capacity.
 * @property {string} attributes.capacity.creature     Description of the number of creatures the vehicle can carry.
 * @property {number} attributes.capacity.cargo        Cargo carrying capacity measured in tons.
 * @property {object} traits
 * @property {string} traits.dimensions                Width and length of the vehicle.
 * @property {object} cargo                            Details on this vehicle's crew and cargo capacities.
 * @property {PassengerData[]} cargo.crew              Creatures responsible for operating the vehicle.
 * @property {PassengerData[]} cargo.passengers        Creatures just takin' a ride.
 */
class VehicleData extends CommonTemplate {
  /** @inheritdoc */
  static _systemType = "vehicle";

  /* -------------------------------------------- */

  /** @inheritdoc */
  static defineSchema() {
    return this.mergeSchema(super.defineSchema(), {
      vehicleType: new foundry.data.fields.StringField({
        required: true,
        initial: "water",
        label: "SdS.VehicleType",
      }),
      attributes: new foundry.data.fields.SchemaField(
        {
          ...AttributesFields.common,
          ac: new foundry.data.fields.SchemaField(
            {
              flat: new foundry.data.fields.NumberField({
                integer: true,
                min: 0,
                label: "SdS.ArmorClassFlat",
              }),
              calc: new foundry.data.fields.StringField({
                initial: "default",
                label: "SdS.ArmorClassCalculation",
              }),
              formula: new FormulaField({
                deterministic: true,
                label: "SdS.ArmorClassFormula",
              }),
              motionless: new foundry.data.fields.StringField({
                required: true,
                label: "SdS.ArmorClassMotionless",
              }),
            },
            { label: "SdS.ArmorClass" }
          ),
          hp: new foundry.data.fields.SchemaField(
            {
              value: new foundry.data.fields.NumberField({
                nullable: true,
                integer: true,
                min: 0,
                initial: null,
                label: "SdS.HitPointsCurrent",
              }),
              max: new foundry.data.fields.NumberField({
                nullable: true,
                integer: true,
                min: 0,
                initial: null,
                label: "SdS.HitPointsMax",
              }),
              temp: new foundry.data.fields.NumberField({
                integer: true,
                initial: 0,
                min: 0,
                label: "SdS.HitPointsTemp",
              }),
              tempmax: new foundry.data.fields.NumberField({
                integer: true,
                initial: 0,
                label: "SdS.HitPointsTempMax",
              }),
              dt: new foundry.data.fields.NumberField({
                required: true,
                integer: true,
                min: 0,
                label: "SdS.DamageThreshold",
              }),
              mt: new foundry.data.fields.NumberField({
                required: true,
                integer: true,
                min: 0,
                label: "SdS.VehicleMishapThreshold",
              }),
            },
            { label: "SdS.HitPoints" }
          ),
          actions: new foundry.data.fields.SchemaField(
            {
              stations: new foundry.data.fields.BooleanField({
                required: true,
                label: "SdS.VehicleActionStations",
              }),
              value: new foundry.data.fields.NumberField({
                required: true,
                nullable: false,
                integer: true,
                initial: 0,
                min: 0,
                label: "SdS.VehicleActionMax",
              }),
              thresholds: new foundry.data.fields.SchemaField(
                {
                  2: new foundry.data.fields.NumberField({
                    required: true,
                    integer: true,
                    min: 0,
                    label: "SdS.VehicleActionThresholdsFull",
                  }),
                  1: new foundry.data.fields.NumberField({
                    required: true,
                    integer: true,
                    min: 0,
                    label: "SdS.VehicleActionThresholdsMid",
                  }),
                  0: new foundry.data.fields.NumberField({
                    required: true,
                    integer: true,
                    min: 0,
                    label: "SdS.VehicleActionThresholdsMin",
                  }),
                },
                { label: "SdS.VehicleActionThresholds" }
              ),
            },
            { label: "SdS.VehicleActions" }
          ),
          capacity: new foundry.data.fields.SchemaField(
            {
              creature: new foundry.data.fields.StringField({
                required: true,
                label: "SdS.VehicleCreatureCapacity",
              }),
              cargo: new foundry.data.fields.NumberField({
                required: true,
                nullable: false,
                integer: true,
                initial: 0,
                min: 0,
                label: "SdS.VehicleCargoCapacity",
              }),
            },
            { label: "SdS.VehicleCargoCrew" }
          ),
        },
        { label: "SdS.Attributes" }
      ),
      details: new foundry.data.fields.SchemaField(DetailsField.common, {
        label: "SdS.Details",
      }),
      traits: new foundry.data.fields.SchemaField(
        {
          ...TraitsField.common,
          size: new foundry.data.fields.StringField({
            required: true,
            initial: "lg",
            label: "SdS.Size",
          }),
          di: TraitsField.makeDamageTrait(
            { label: "SdS.DamImm" },
            { initial: ["poison", "psychic"] }
          ),
          ci: TraitsField.makeSimpleTrait(
            { label: "SdS.ConImm" },
            {
              initial: [
                "blinded",
                "charmed",
                "deafened",
                "frightened",
                "paralyzed",
                "petrified",
                "poisoned",
                "stunned",
                "unconscious",
              ],
            }
          ),
          dimensions: new foundry.data.fields.StringField({
            required: true,
            label: "SdS.Dimensions",
          }),
        },
        { label: "SdS.Traits" }
      ),
      cargo: new foundry.data.fields.SchemaField(
        {
          crew: new foundry.data.fields.ArrayField(makePassengerData(), {
            label: "SdS.VehicleCrew",
          }),
          passengers: new foundry.data.fields.ArrayField(makePassengerData(), {
            label: "SdS.VehiclePassengers",
          }),
        },
        { label: "SdS.VehicleCrewPassengers" }
      ),
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static migrateData(source) {
    super.migrateData(source);
    AttributesFields._migrateInitiative(source.attributes);
  }
}

/* -------------------------------------------- */

/**
 * Data structure for an entry in a vehicle's crew or passenger lists.
 *
 * @typedef {object} PassengerData
 * @property {string} name      Name of individual or type of creature.
 * @property {number} quantity  How many of this creature are onboard?
 */

/**
 * Produce the schema field for a simple trait.
 * @param {object} schemaOptions  Options passed to the outer schema.
 * @returns {PassengerData}
 */
function makePassengerData(schemaOptions = {}) {
  return new foundry.data.fields.SchemaField(
    {
      name: new foundry.data.fields.StringField({
        required: true,
        label: "SdS.VehiclePassengerName",
      }),
      quantity: new foundry.data.fields.NumberField({
        required: true,
        nullable: false,
        integer: true,
        initial: 0,
        min: 0,
        label: "SdS.VehiclePassengerQuantity",
      }),
    },
    schemaOptions
  );
}

const config$2 = {
  character: CharacterData,
  group: GroupActor,
  npc: NPCData,
  vehicle: VehicleData,
};

var _module$4 = /*#__PURE__*/ Object.freeze({
  __proto__: null,
  AttributesFields: AttributesFields,
  CharacterData: CharacterData,
  CommonTemplate: CommonTemplate,
  CreatureTemplate: CreatureTemplate,
  DetailsFields: DetailsField,
  GroupData: GroupActor,
  NPCData: NPCData,
  TraitsFields: TraitsField,
  VehicleData: VehicleData,
  config: config$2,
});

var _module$3 = /*#__PURE__*/ Object.freeze({
  __proto__: null,
  BaseAdvancement: BaseAdvancement,
  ItemGrantConfigurationData: ItemGrantConfigurationData,
  SpellConfigurationData: SpellConfigurationData,
  scaleValue: scaleValue,
});

/**
 * Data model template with item description & source.
 *
 * @property {object} description               Various item descriptions.
 * @property {string} description.value         Full item description.
 * @property {string} description.chat          Description displayed in chat card.
 * @property {string} description.unidentified  Description displayed if item is unidentified.
 * @property {string} source                    Adventure or sourcebook where this item originated.
 * @mixin
 */
class ItemDescriptionTemplate extends foundry.abstract.DataModel {
  /** @inheritdoc */
  static defineSchema() {
    return {
      description: new foundry.data.fields.SchemaField({
        value: new foundry.data.fields.HTMLField({
          required: true,
          nullable: true,
          label: "SdS.Description",
        }),
        chat: new foundry.data.fields.HTMLField({
          required: true,
          nullable: true,
          label: "SdS.DescriptionChat",
        }),
        unidentified: new foundry.data.fields.HTMLField({
          required: true,
          nullable: true,
          label: "SdS.DescriptionUnidentified",
        }),
      }),
      source: new foundry.data.fields.StringField({
        required: true,
        label: "SdS.Source",
      }),
    };
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static migrateData(source) {
    ItemDescriptionTemplate.#migrateSource(source);
  }

  /* -------------------------------------------- */

  /**
   * Convert null source to the blank string.
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migrateSource(source) {
    if (source.source === null) source.source = "";
  }
}

/**
 * Data definition for Background items.
 * @mixes ItemDescriptionTemplate
 *
 * @property {object[]} advancement  Advancement objects for this background.
 */
class BackgroundData extends SystemDataModel.mixin(ItemDescriptionTemplate) {
  /** @inheritdoc */
  static defineSchema() {
    return this.mergeSchema(super.defineSchema(), {
      advancement: new foundry.data.fields.ArrayField(new AdvancementField(), {
        label: "SdS.AdvancementTitle",
      }),
    });
  }
}

/**
 * Data definition for Class items.
 * @mixes ItemDescriptionTemplate
 *
 * @property {string} identifier        Identifier slug for this class.
 * @property {number} levels            Current number of levels in this class.
 * @property {string} hitDice           Denomination of hit dice available as defined in `SdS.hitDieTypes`.
 * @property {number} hitDiceUsed       Number of hit dice consumed.
 * @property {object[]} advancement     Advancement objects for this class.
 * @property {string[]} saves           Savings throws in which this class grants proficiency.
 * @property {object} skills            Available class skills and selected skills.
 * @property {number} skills.number     Number of skills selectable by the player.
 * @property {string[]} skills.choices  List of skill keys that are valid to be chosen.
 * @property {string[]} skills.value    List of skill keys the player has chosen.
 * @property {object} spellcasting      Details on class's spellcasting ability.
 * @property {string} spellcasting.progression  Spell progression granted by class as from `SdS.spellProgression`.
 * @property {string} spellcasting.ability      Ability score to use for spellcasting.
 */
class ClassData extends SystemDataModel.mixin(ItemDescriptionTemplate) {
  /** @inheritdoc */
  static defineSchema() {
    return this.mergeSchema(super.defineSchema(), {
      identifier: new IdentifierField({
        required: true,
        label: "SdS.Identifier",
      }),
      levels: new foundry.data.fields.NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        initial: 1,
        label: "SdS.ClassLevels",
      }),
      hitDice: new foundry.data.fields.StringField({
        required: true,
        initial: "d6",
        blank: false,
        label: "SdS.HitDice",
        validate: (v) => /d\d+/.test(v),
        validationError: "must be a dice value in the format d#",
      }),
      hitDiceUsed: new foundry.data.fields.NumberField({
        required: true,
        nullable: false,
        integer: true,
        initial: 0,
        min: 0,
        label: "SdS.HitDiceUsed",
      }),
      mana: new foundry.data.fields.NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        initial: 0,
        label: "SdS.Mana",
      }),
      mana_percentage: new foundry.data.fields.NumberField({
        required: true,
        nullable: false,
        integer: false,
        min: 0,
        initial: 1,
        label: "SdS.ManaPercentage",
      }),
      spell_schools: new foundry.data.fields.ArrayField(
        new foundry.data.fields.StringField(),
        {
          required: true,
          nullable: true,
          initial: null,
          label: "SdS.SpellSchool",
        }
      ),
      spell_elements: new foundry.data.fields.ArrayField(
        new foundry.data.fields.StringField(),
        {
          required: true,
          nullable: true,
          initial: null,
          label: "SdS.SpellElements",
        }
      ),
      max_spell_level: new foundry.data.fields.NumberField({
        required: true,
        nullable: false,
        integer: true,
        min: 0,
        initial: 0,
        label: "Sds.SpellMaxLevel",
      }),
      advancement: new foundry.data.fields.ArrayField(new AdvancementField(), {
        label: "SdS.AdvancementTitle",
      }),
      saves: new foundry.data.fields.ArrayField(
        new foundry.data.fields.StringField(),
        { label: "SdS.ClassSaves" }
      ),
      skills: new foundry.data.fields.SchemaField({
        number: new foundry.data.fields.NumberField({
          required: true,
          nullable: false,
          integer: true,
          min: 0,
          initial: 2,
          label: "SdS.ClassSkillsNumber",
        }),
        choices: new foundry.data.fields.ArrayField(
          new foundry.data.fields.StringField(),
          { label: "SdS.ClassSkillsEligible" }
        ),
        value: new foundry.data.fields.ArrayField(
          new foundry.data.fields.StringField(),
          { label: "SdS.ClassSkillsChosen" }
        ),
      }),
      spellcasting: new foundry.data.fields.SchemaField(
        {
          progression: new foundry.data.fields.StringField({
            required: true,
            initial: "none",
            blank: false,
            label: "SdS.SpellProgression",
          }),
          ability: new foundry.data.fields.StringField({
            required: true,
            label: "SdS.SpellAbility",
          }),
        },
        { label: "SdS.Spellcasting" }
      ),
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static migrateData(source) {
    super.migrateData(source);
    ClassData.#migrateLevels(source);
    ClassData.#migrateSpellcastingData(source);
  }

  /* -------------------------------------------- */

  /**
   * Migrate the class levels.
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migrateLevels(source) {
    if (typeof source.levels !== "string") return;
    if (source.levels === "") source.levels = 1;
    else if (Number.isNumeric(source.levels))
      source.levels = Number(source.levels);
  }

  /* -------------------------------------------- */

  /**
   * Migrate the class's spellcasting string to object.
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migrateSpellcastingData(source) {
    if (source.spellcasting?.progression === "")
      source.spellcasting.progression = "none";
    if (typeof source.spellcasting !== "string") return;
    source.spellcasting = {
      progression: source.spellcasting,
      ability: "",
    };
  }
}

/**
 * Data model template for item actions.
 *
 * @property {string} ability             Ability score to use when determining modifier.
 * @property {string} actionType          Action type as defined in `SdS.itemActionTypes`.
 * @property {string} attackBonus         Numeric or dice bonus to attack rolls.
 * @property {string} chatFlavor          Extra text displayed in chat.
 * @property {object} critical            Information on how critical hits are handled.
 * @property {number} critical.threshold  Minimum number on the dice to roll a critical hit.
 * @property {string} critical.damage     Extra damage on critical hit.
 * @property {object} damage              Item damage formulas.
 * @property {string[][]} damage.parts    Array of damage formula and types.
 * @property {string} damage.versatile    Special versatile damage formula.
 * @property {string} formula             Other roll formula.
 * @property {object} save                Item saving throw data.
 * @property {string} save.ability        Ability required for the save.
 * @property {number} save.dc             Custom saving throw value.
 * @property {string} save.scaling        Method for automatically determining saving throw DC.
 * @mixin
 */
class ActionTemplate extends foundry.abstract.DataModel {
  /** @inheritdoc */
  static defineSchema() {
    return {
      ability: new foundry.data.fields.StringField({
        required: true,
        nullable: true,
        initial: null,
        label: "SdS.AbilityModifier",
      }),
      actionType: new foundry.data.fields.StringField({
        required: true,
        nullable: true,
        initial: null,
        label: "SdS.ItemActionType",
      }),
      attackBonus: new FormulaField({
        required: true,
        label: "SdS.ItemAttackBonus",
      }),
      chatFlavor: new foundry.data.fields.StringField({
        required: true,
        label: "SdS.ChatFlavor",
      }),
      critical: new foundry.data.fields.SchemaField({
        threshold: new foundry.data.fields.NumberField({
          required: true,
          integer: true,
          initial: null,
          positive: true,
          label: "SdS.ItemCritThreshold",
        }),
        damage: new FormulaField({
          required: true,
          label: "SdS.ItemCritExtraDamage",
        }),
      }),
      damage: new foundry.data.fields.SchemaField(
        {
          parts: new foundry.data.fields.ArrayField(
            new foundry.data.fields.ArrayField(
              new foundry.data.fields.StringField({ nullable: true })
            ),
            { required: true }
          ),
          versatile: new FormulaField({
            required: true,
            label: "SdS.VersatileDamage",
          }),
        },
        { label: "SdS.Damage" }
      ),
      formula: new FormulaField({
        required: true,
        label: "SdS.OtherFormula",
      }),
      save: new foundry.data.fields.SchemaField(
        {
          ability: new foundry.data.fields.StringField({
            required: true,
            blank: true,
            label: "SdS.Ability",
          }),
          dc: new foundry.data.fields.NumberField({
            required: true,
            min: 0,
            integer: true,
            label: "SdS.AbbreviationDC",
          }),
          scaling: new foundry.data.fields.StringField({
            required: true,
            blank: false,
            initial: "spell",
            label: "SdS.ScalingFormula",
          }),
        },
        { label: "SdS.SavingThrow" }
      ),
    };
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static migrateData(source) {
    ActionTemplate.#migrateAbility(source);
    ActionTemplate.#migrateAttackBonus(source);
    ActionTemplate.#migrateCritical(source);
    ActionTemplate.#migrateSave(source);
    ActionTemplate.#migrateDamage(source);
  }

  /* -------------------------------------------- */

  /**
   * Migrate the ability field.
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migrateAbility(source) {
    if (Array.isArray(source.ability)) source.ability = source.ability[0];
  }

  /* -------------------------------------------- */

  /**
   * Ensure a 0 or null in attack bonus is converted to an empty string rather than "0".
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migrateAttackBonus(source) {
    if ([0, "0", null].includes(source.attackBonus)) source.attackBonus = "";
    else if (typeof source.attackBonus === "number")
      source.attackBonus = source.attackBonus.toString();
  }

  /* -------------------------------------------- */

  /**
   * Ensure the critical field is an object.
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migrateCritical(source) {
    if (!("critical" in source)) return;
    if (source.critical?.damage === null) source.critical.damage = "";
    if (typeof source.critical !== "object" || source.critical === null)
      source.critical = {
        threshold: null,
        damage: "",
      };
  }

  /* -------------------------------------------- */

  /**
   * Migrate the save field.
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migrateSave(source) {
    if (source.save?.scaling === "") source.save.scaling = "spell";
    if (source.save?.ability === null) source.save.ability = "";
    if (typeof source.save?.dc === "string") {
      if (source.save.dc === "") source.save.dc = null;
      else if (Number.isNumeric(source.save.dc))
        source.save.dc = Number(source.save.dc);
    }
  }

  /* -------------------------------------------- */

  /**
   * Migrate damage parts.
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migrateDamage(source) {
    if (!("damage" in source)) return;
    source.damage.parts ??= [];
  }
}

/**
 * Data model template for items that can be used as some sort of action.
 *
 * @property {object} activation            Effect's activation conditions.
 * @property {string} activation.type       Activation type as defined in `SdS.abilityActivationTypes`.
 * @property {number} activation.cost       How much of the activation type is needed to use this item's effect.
 * @property {string} activation.condition  Special conditions required to activate the item.
 * @property {object} duration              Effect's duration.
 * @property {number} duration.value        How long the effect lasts.
 * @property {string} duration.units        Time duration period as defined in `SdS.timePeriods`.
 * @property {object} target                Effect's valid targets.
 * @property {number} target.value          Length or radius of target depending on targeting mode selected.
 * @property {number} target.width          Width of line when line type is selected.
 * @property {string} target.units          Units used for value and width as defined in `SdS.distanceUnits`.
 * @property {string} target.type           Targeting mode as defined in `SdS.targetTypes`.
 * @property {object} range                 Effect's range.
 * @property {number} range.value           Regular targeting distance for item's effect.
 * @property {number} range.long            Maximum targeting distance for features that have a separate long range.
 * @property {string} range.units           Units used for value and long as defined in `SdS.distanceUnits`.
 * @property {object} uses                  Effect's limited uses.
 * @property {number} uses.value            Current available uses.
 * @property {string} uses.max              Maximum possible uses or a formula to derive that number.
 * @property {string} uses.per              Recharge time for limited uses as defined in `SdS.limitedUsePeriods`.
 * @property {object} consume               Effect's resource consumption.
 * @property {string} consume.type          Type of resource to consume as defined in `SdS.abilityConsumptionTypes`.
 * @property {string} consume.target        Item ID or resource key path of resource to consume.
 * @property {number} consume.amount        Quantity of the resource to consume per use.
 * @mixin
 */
class ActivatedEffectTemplate extends foundry.abstract.DataModel {
  /** @inheritdoc */
  static defineSchema() {
    return {
      activation: new foundry.data.fields.SchemaField(
        {
          type: new foundry.data.fields.StringField({
            required: true,
            blank: true,
            label: "SdS.ItemActivationType",
          }),
          cost: new foundry.data.fields.NumberField({
            required: true,
            label: "SdS.ItemActivationCost",
          }),
          condition: new foundry.data.fields.StringField({
            required: true,
            label: "SdS.ItemActivationCondition",
          }),
        },
        { label: "SdS.ItemActivation" }
      ),
      duration: new foundry.data.fields.SchemaField(
        {
          value: new FormulaField({
            required: true,
            deterministic: true,
            label: "SdS.Duration",
          }),
          units: new foundry.data.fields.StringField({
            required: true,
            blank: true,
            label: "SdS.DurationType",
          }),
        },
        { label: "SdS.Duration" }
      ),
      target: new foundry.data.fields.SchemaField(
        {
          value: new foundry.data.fields.NumberField({
            required: true,
            min: 0,
            label: "SdS.TargetValue",
          }),
          width: new foundry.data.fields.NumberField({
            required: true,
            min: 0,
            label: "SdS.TargetWidth",
          }),
          units: new foundry.data.fields.StringField({
            required: true,
            blank: true,
            label: "SdS.TargetUnits",
          }),
          type: new foundry.data.fields.StringField({
            required: true,
            blank: true,
            label: "SdS.TargetType",
          }),
        },
        { label: "SdS.Target" }
      ),
      range: new foundry.data.fields.SchemaField(
        {
          value: new foundry.data.fields.NumberField({
            required: true,
            min: 0,
            label: "SdS.RangeNormal",
          }),
          long: new foundry.data.fields.NumberField({
            required: true,
            min: 0,
            label: "SdS.RangeLong",
          }),
          units: new foundry.data.fields.StringField({
            required: true,
            blank: true,
            label: "SdS.RangeUnits",
          }),
        },
        { label: "SdS.Range" }
      ),
      uses: new this.ItemUsesField({}, { label: "SdS.LimitedUses" }),
      consume: new foundry.data.fields.SchemaField(
        {
          type: new foundry.data.fields.StringField({
            required: true,
            blank: true,
            label: "SdS.ConsumeType",
          }),
          target: new foundry.data.fields.StringField({
            required: true,
            nullable: true,
            initial: null,
            label: "SdS.ConsumeTarget",
          }),
          amount: new foundry.data.fields.NumberField({
            required: true,
            integer: true,
            label: "SdS.ConsumeAmount",
          }),
        },
        { label: "SdS.ConsumeTitle" }
      ),
    };
  }

  /* -------------------------------------------- */

  /**
   * Extension of SchemaField used to track item uses.
   * @internal
   */
  static ItemUsesField = class ItemUsesField extends foundry.data.fields
    .SchemaField {
    constructor(extraSchema, options) {
      super(
        SystemDataModel.mergeSchema(
          {
            value: new foundry.data.fields.NumberField({
              required: true,
              min: 0,
              integer: true,
              label: "SdS.LimitedUsesAvailable",
            }),
            max: new FormulaField({
              required: true,
              deterministic: true,
              label: "SdS.LimitedUsesMax",
            }),
            per: new foundry.data.fields.StringField({
              required: true,
              nullable: true,
              initial: null,
              label: "SdS.LimitedUsesPer",
            }),
            recovery: new FormulaField({
              required: true,
              label: "SdS.RecoveryFormula",
            }),
          },
          extraSchema
        ),
        options
      );
    }
  };

  /* -------------------------------------------- */

  /** @inheritdoc */
  static migrateData(source) {
    ActivatedEffectTemplate.#migrateFormulaFields(source);
    ActivatedEffectTemplate.#migrateRanges(source);
    ActivatedEffectTemplate.#migrateTargets(source);
    ActivatedEffectTemplate.#migrateUses(source);
    ActivatedEffectTemplate.#migrateConsume(source);
  }

  /* -------------------------------------------- */

  /**
   * Ensure a 0 or null in max uses & durations are converted to an empty string rather than "0". Convert numbers into
   * strings.
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migrateFormulaFields(source) {
    if ([0, "0", null].includes(source.uses?.max)) source.uses.max = "";
    else if (typeof source.uses?.max === "number")
      source.uses.max = source.uses.max.toString();
    if ([0, "0", null].includes(source.duration?.value))
      source.duration.value = "";
    else if (typeof source.duration?.value === "number")
      source.duration.value = source.duration.value.toString();
  }

  /* -------------------------------------------- */

  /**
   * Fix issue with some imported range data that uses the format "100/400" in the range field,
   * rather than splitting it between "range.value" & "range.long".
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migrateRanges(source) {
    if (!("range" in source)) return;
    if (source.range.units === null) source.range.units = "";
    if (typeof source.range.long === "string") {
      if (source.range.long === "") source.range.long = null;
      else if (Number.isNumeric(source.range.long))
        source.range.long = Number(source.range.long);
    }
    if (typeof source.range.value !== "string") return;
    if (source.range.value === "") {
      source.range.value = null;
      return;
    }
    const [value, long] = source.range.value.split("/");
    if (Number.isNumeric(value)) source.range.value = Number(value);
    if (Number.isNumeric(long)) source.range.long = Number(long);
  }

  /* -------------------------------------------- */

  /**
   * Ensure blank strings in targets are converted to null.
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migrateTargets(source) {
    if (source.target?.value === "") source.target.value = null;
    if (source.target?.units === null) source.target.units = "";
    if (source.target?.type === null) source.target.type = "";
  }

  /* -------------------------------------------- */

  /**
   * Ensure a blank string in uses.value is converted to null.
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migrateUses(source) {
    if (!("uses" in source)) return;
    const value = source.uses.value;
    if (typeof value === "string") {
      if (value === "") source.uses.value = null;
      else if (Number.isNumeric(value))
        source.uses.value = Number(source.uses.value);
    }
    if (source.uses.recovery === undefined) source.uses.recovery = "";
  }

  /* -------------------------------------------- */

  /**
   * Migrate the consume field.
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migrateConsume(source) {
    if (!("consume" in source)) return;
    if (source.consume.type === null) source.consume.type = "";
    const amount = source.consume.amount;
    if (typeof amount === "string") {
      if (amount === "") source.consume.amount = null;
      else if (Number.isNumeric(amount)) source.consume.amount = Number(amount);
    }
  }
}

/**
 * Data model template with information on items that can be attuned and equipped.
 *
 * @property {number} attunement  Attunement information as defined in `SdS.attunementTypes`.
 * @property {boolean} equipped   Is this item equipped on its owning actor.
 * @mixin
 */
class EquippableItemTemplate extends foundry.abstract.DataModel {
  /** @inheritdoc */
  static defineSchema() {
    return {
      attunement: new foundry.data.fields.NumberField({
        required: true,
        integer: true,
        initial: CONFIG.SdS.attunementTypes.NONE,
        label: "SdS.Attunement",
      }),
      equipped: new foundry.data.fields.BooleanField({
        required: true,
        label: "SdS.Equipped",
      }),
    };
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static migrateData(source) {
    EquippableItemTemplate.#migrateAttunement(source);
    EquippableItemTemplate.#migrateEquipped(source);
  }

  /* -------------------------------------------- */

  /**
   * Migrate the item's attuned boolean to attunement string.
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migrateAttunement(source) {
    if (source.attuned === undefined || source.attunement !== undefined) return;
    source.attunement = source.attuned
      ? CONFIG.SdS.attunementTypes.ATTUNED
      : CONFIG.SdS.attunementTypes.NONE;
  }

  /* -------------------------------------------- */

  /**
   * Migrate the equipped field.
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migrateEquipped(source) {
    if (source.equipped === null || source.equipped === undefined)
      source.equipped = false;
  }
}

/**
 * Data model template with information on physical items.
 *
 * @property {number} quantity            Number of items in a stack.
 * @property {number} weight              Item's weight in pounds or kilograms (depending on system setting).
 * @property {object} price
 * @property {number} price.value         Item's cost in the specified denomination.
 * @property {string} price.denomination  Currency denomination used to determine price.
 * @property {string} rarity              Item rarity as defined in `SdS.itemRarity`.
 * @property {boolean} identified         Has this item been identified?
 * @mixin
 */
class PhysicalItemTemplate extends foundry.abstract.DataModel {
  /** @inheritdoc */
  static defineSchema() {
    return {
      quantity: new foundry.data.fields.NumberField({
        required: true,
        nullable: false,
        integer: true,
        initial: 1,
        min: 0,
        label: "SdS.Quantity",
      }),
      weight: new foundry.data.fields.NumberField({
        required: true,
        nullable: false,
        initial: 0,
        min: 0,
        label: "SdS.Weight",
      }),
      price: new foundry.data.fields.SchemaField(
        {
          value: new foundry.data.fields.NumberField({
            required: true,
            nullable: false,
            initial: 0,
            min: 0,
            label: "SdS.Price",
          }),
          denomination: new foundry.data.fields.StringField({
            required: true,
            blank: false,
            initial: "gp",
            label: "SdS.Currency",
          }),
        },
        { label: "SdS.Price" }
      ),
      rarity: new foundry.data.fields.StringField({
        required: true,
        blank: true,
        label: "SdS.Rarity",
      }),
      identified: new foundry.data.fields.BooleanField({
        required: true,
        initial: true,
        label: "SdS.Identified",
      }),
    };
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static migrateData(source) {
    PhysicalItemTemplate.#migratePrice(source);
    PhysicalItemTemplate.#migrateRarity(source);
    PhysicalItemTemplate.#migrateWeight(source);
  }

  /* -------------------------------------------- */

  /**
   * Migrate the item's price from a single field to an object with currency.
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migratePrice(source) {
    if (foundry.utils.getType(source.price) === "Object") return;
    source.price = {
      value: Number.isNumeric(source.price) ? Number(source.price) : 0,
      denomination: "gp",
    };
  }

  /* -------------------------------------------- */

  /**
   * Migrate the item's rarity from freeform string to enum value.
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migrateRarity(source) {
    if (!("rarity" in source) || CONFIG.SdS.itemRarity[source.rarity]) return;
    source.rarity =
      Object.keys(CONFIG.SdS.itemRarity).find(
        (key) =>
          CONFIG.SdS.itemRarity[key].toLowerCase() ===
          source.rarity.toLowerCase()
      ) ?? "";
  }

  /* -------------------------------------------- */

  /**
   * Convert null weights to 0.
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migrateWeight(source) {
    if (source.weight === null || source.weight === undefined)
      source.weight = 0;
  }
}

/**
 * Data definition for Consumable items.
 * @mixes ItemDescriptionTemplate
 * @mixes PhysicalItemTemplate
 * @mixes EquippableItemTemplate
 * @mixes ActivatedEffectTemplate
 * @mixes ActionTemplate
 *
 * @property {string} consumableType     Type of consumable as defined in `SdS.consumableTypes`.
 * @property {object} uses
 * @property {boolean} uses.autoDestroy  Should this item be destroyed when it runs out of uses.
 */
class ConsumableData extends SystemDataModel.mixin(
  ItemDescriptionTemplate,
  PhysicalItemTemplate,
  EquippableItemTemplate,
  ActivatedEffectTemplate,
  ActionTemplate
) {
  /** @inheritdoc */
  static defineSchema() {
    return this.mergeSchema(super.defineSchema(), {
      consumableType: new foundry.data.fields.StringField({
        required: true,
        initial: "potion",
        label: "SdS.ItemConsumableType",
      }),
      uses: new ActivatedEffectTemplate.ItemUsesField(
        {
          autoDestroy: new foundry.data.fields.BooleanField({
            required: true,
            label: "SdS.ItemDestroyEmpty",
          }),
        },
        { label: "SdS.LimitedUses" }
      ),
    });
  }
}

/**
 * Data definition for Backpack items.
 * @mixes ItemDescriptionTemplate
 * @mixes PhysicalItemTemplate
 * @mixes EquippableItemTemplate
 * @mixes CurrencyTemplate
 *
 * @property {object} capacity              Information on container's carrying capacity.
 * @property {string} capacity.type         Method for tracking max capacity as defined in `SdS.itemCapacityTypes`.
 * @property {number} capacity.value        Total amount of the type this container can carry.
 * @property {boolean} capacity.weightless  Does the weight of the items in the container carry over to the actor?
 */
class ContainerData extends SystemDataModel.mixin(
  ItemDescriptionTemplate,
  PhysicalItemTemplate,
  EquippableItemTemplate,
  CurrencyTemplate
) {
  /** @inheritdoc */
  static defineSchema() {
    return this.mergeSchema(super.defineSchema(), {
      capacity: new foundry.data.fields.SchemaField(
        {
          type: new foundry.data.fields.StringField({
            required: true,
            initial: "weight",
            blank: false,
            label: "SdS.ItemContainerCapacityType",
          }),
          value: new foundry.data.fields.NumberField({
            required: true,
            min: 0,
            label: "SdS.ItemContainerCapacityMax",
          }),
          weightless: new foundry.data.fields.BooleanField({
            required: true,
            label: "SdS.ItemContainerWeightless",
          }),
        },
        { label: "SdS.ItemContainerCapacity" }
      ),
    });
  }
}

/**
 * Data model template for equipment that can be mounted on a vehicle.
 *
 * @property {object} armor          Equipment's armor class.
 * @property {number} armor.value    Armor class value for equipment.
 * @property {object} hp             Equipment's hit points.
 * @property {number} hp.value       Current hit point value.
 * @property {number} hp.max         Max hit points.
 * @property {number} hp.dt          Damage threshold.
 * @property {string} hp.conditions  Conditions that are triggered when this equipment takes damage.
 * @mixin
 */
class MountableTemplate extends foundry.abstract.DataModel {
  /** @inheritdoc */
  static defineSchema() {
    return {
      armor: new foundry.data.fields.SchemaField(
        {
          value: new foundry.data.fields.NumberField({
            required: true,
            integer: true,
            min: 0,
            label: "SdS.ArmorClass",
          }),
        },
        { label: "SdS.ArmorClass" }
      ),
      hp: new foundry.data.fields.SchemaField(
        {
          value: new foundry.data.fields.NumberField({
            required: true,
            integer: true,
            min: 0,
            label: "SdS.HitPointsCurrent",
          }),
          max: new foundry.data.fields.NumberField({
            required: true,
            integer: true,
            min: 0,
            label: "SdS.HitPointsMax",
          }),
          dt: new foundry.data.fields.NumberField({
            required: true,
            integer: true,
            min: 0,
            label: "SdS.DamageThreshold",
          }),
          conditions: new foundry.data.fields.StringField({
            required: true,
            label: "SdS.HealthConditions",
          }),
        },
        { label: "SdS.HitPoints" }
      ),
    };
  }
}

/**
 * Data definition for Equipment items.
 * @mixes ItemDescriptionTemplate
 * @mixes PhysicalItemTemplate
 * @mixes EquippableItemTemplate
 * @mixes ActivatedEffectTemplate
 * @mixes ActionTemplate
 * @mixes MountableTemplate
 *
 * @property {object} armor             Armor details and equipment type information.
 * @property {string} armor.type        Equipment type as defined in `SdS.equipmentTypes`.
 * @property {number} armor.value       Base armor class or shield bonus.
 * @property {number} armor.dex         Maximum dex bonus added to armor class.
 * @property {string} baseItem          Base armor as defined in `SdS.armorIds` for determining proficiency.
 * @property {object} speed             Speed granted by a piece of vehicle equipment.
 * @property {number} speed.value       Speed granted by this piece of equipment measured in feet or meters
 *                                      depending on system setting.
 * @property {string} speed.conditions  Conditions that may affect item's speed.
 * @property {number} strength          Minimum strength required to use a piece of armor.
 * @property {boolean} stealth          Does this equipment grant disadvantage on stealth checks when used?
 * @property {boolean} proficient       Does the owner have proficiency in this piece of equipment?
 */
class EquipmentData extends SystemDataModel.mixin(
  ItemDescriptionTemplate,
  PhysicalItemTemplate,
  EquippableItemTemplate,
  ActivatedEffectTemplate,
  ActionTemplate,
  MountableTemplate
) {
  /** @inheritdoc */
  static defineSchema() {
    return this.mergeSchema(super.defineSchema(), {
      armor: new foundry.data.fields.SchemaField(
        {
          type: new foundry.data.fields.StringField({
            required: true,
            initial: "light",
            label: "SdS.ItemEquipmentType",
          }),
          value: new foundry.data.fields.NumberField({
            required: true,
            integer: true,
            min: 0,
            label: "SdS.ArmorClass",
          }),
          dex: new foundry.data.fields.NumberField({
            required: true,
            integer: true,
            label: "SdS.ItemEquipmentDexMod",
          }),
        },
        { label: "" }
      ),
      baseItem: new foundry.data.fields.StringField({
        required: true,
        label: "SdS.ItemEquipmentBase",
      }),
      speed: new foundry.data.fields.SchemaField(
        {
          value: new foundry.data.fields.NumberField({
            required: true,
            min: 0,
            label: "SdS.Speed",
          }),
          conditions: new foundry.data.fields.StringField({
            required: true,
            label: "SdS.SpeedConditions",
          }),
        },
        { label: "SdS.Speed" }
      ),
      strength: new foundry.data.fields.NumberField({
        required: true,
        integer: true,
        min: 0,
        label: "SdS.ItemRequiredStr",
      }),
      stealth: new foundry.data.fields.BooleanField({
        required: true,
        label: "SdS.ItemEquipmentStealthDisav",
      }),
      proficient: new foundry.data.fields.BooleanField({
        required: true,
        initial: true,
        label: "SdS.Proficient",
      }),
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static migrateData(source) {
    super.migrateData(source);
    EquipmentData.#migrateArmor(source);
    EquipmentData.#migrateStrength(source);
  }

  /* -------------------------------------------- */

  /**
   * Apply migrations to the armor field.
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migrateArmor(source) {
    source.armor ??= {};
    if (source.armor.type === "bonus") source.armor.type = "trinket";
    if (typeof source.armor.dex === "string") {
      const dex = source.armor.dex;
      if (dex === "") source.armor.dex = null;
      else if (Number.isNumeric(dex)) source.armor.dex = Number(dex);
    }
  }

  /* -------------------------------------------- */

  /**
   * Ensure blank strength values are migrated to null, and string values are converted to numbers.
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migrateStrength(source) {
    if (typeof source.strength !== "string") return;
    if (source.strength === "") source.strength = null;
    if (Number.isNumeric(source.strength))
      source.strength = Number(source.strength);
  }
}

/**
 * Data definition for Feature items.
 * @mixes ItemDescriptionTemplate
 * @mixes ActivatedEffectTemplate
 * @mixes ActionTemplate
 *
 * @property {object} type
 * @property {string} type.value         Category to which this feature belongs.
 * @property {string} type.subtype       Feature subtype according to its category.
 * @property {string} requirements       Actor details required to use this feature.
 * @property {object} recharge           Details on how a feature can roll for recharges.
 * @property {number} recharge.value     Minimum number needed to roll on a d6 to recharge this feature.
 * @property {boolean} recharge.charged  Does this feature have a charge remaining?
 */
class FeatData extends SystemDataModel.mixin(
  ItemDescriptionTemplate,
  ActivatedEffectTemplate,
  ActionTemplate
) {
  /** @inheritdoc */
  static defineSchema() {
    return this.mergeSchema(super.defineSchema(), {
      type: new foundry.data.fields.SchemaField(
        {
          value: new foundry.data.fields.StringField({ required: true }),
          subtype: new foundry.data.fields.StringField({ required: true }),
        },
        { label: "SdS.ItemFeatureType" }
      ),
      requirements: new foundry.data.fields.StringField({
        required: true,
        nullable: true,
        label: "SdS.Requirements",
      }),
      recharge: new foundry.data.fields.SchemaField(
        {
          value: new foundry.data.fields.NumberField({
            required: true,
            integer: true,
            min: 1,
            label: "SdS.FeatureRechargeOn",
          }),
          charged: new foundry.data.fields.BooleanField({
            required: true,
            label: "SdS.Charged",
          }),
        },
        { label: "SdS.FeatureActionRecharge" }
      ),
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static migrateData(source) {
    super.migrateData(source);
    FeatData.#migrateType(source);
    FeatData.#migrateRecharge(source);
  }

  /* -------------------------------------------- */

  /**
   * Ensure feats have a type object.
   * @param {object} source The candidate source data from which the model will be constructed.
   */
  static #migrateType(source) {
    if (!source.type) source.type = { value: "", subtype: "" };
  }

  /* -------------------------------------------- */

  /**
   * Migrate 0 values to null.
   * @param {object} source The candidate source data from which the model will be constructed.
   */
  static #migrateRecharge(source) {
    if (!("recharge" in source)) return;
    const value = source.recharge.value;
    if (value === 0 || value === "") source.recharge.value = null;
    else if (typeof value === "string" && Number.isNumeric(value))
      source.recharge.value = Number(value);
    if (source.recharge.charged === null) source.recharge.charged = false;
  }
}

/**
 * Data definition for Loot items.
 * @mixes ItemDescriptionTemplate
 * @mixes PhysicalItemTemplate
 */
class LootData extends SystemDataModel.mixin(
  ItemDescriptionTemplate,
  PhysicalItemTemplate
) {}

/**
 * Data definition for Spell items.
 * @mixes ItemDescriptionTemplate
 * @mixes ActivatedEffectTemplate
 * @mixes ActionTemplate
 *
 * @property {number} level                      Base level of the spell.
 * @property {string} school                     Magical school to which this spell belongs.
 * @property {string} element                    Magical element to which this spell belongs.
 * @property {object} components                 General components and tags for this spell.
 * @property {number} mana                       Mana cost to cast the spell.
 * @property {boolean} components.vocal          Does this spell require vocal components?
 * @property {boolean} components.somatic        Does this spell require somatic components?
 * @property {boolean} components.material       Does this spell require material components?
 * @property {boolean} components.ritual         Can this spell be cast as a ritual?
 * @property {boolean} components.concentration  Does this spell require concentration?
 * @property {object} materials                  Details on material components required for this spell.
 * @property {string} materials.value            Description of the material components required for casting.
 * @property {boolean} materials.consumed        Are these material components consumed during casting?
 * @property {number} materials.cost             GP cost for the required components.
 * @property {number} materials.supply           Quantity of this component available.
 * @property {object} preparation                Details on how this spell is prepared.
 * @property {string} preparation.mode           Spell preparation mode as defined in `SdS.spellPreparationModes`.
 * @property {boolean} preparation.prepared      Is the spell currently prepared?
 * @property {object} scaling                    Details on how casting at higher levels affects this spell.
 * @property {string} scaling.mode               Spell scaling mode as defined in `SdS.spellScalingModes`.
 * @property {string} scaling.formula            Dice formula used for scaling.
 */
class SpellData extends SystemDataModel.mixin(
  ItemDescriptionTemplate,
  ActivatedEffectTemplate,
  ActionTemplate
) {
  /** @inheritdoc */
  static defineSchema() {
    return this.mergeSchema(super.defineSchema(), {
      level: new foundry.data.fields.NumberField({
        required: true,
        integer: true,
        initial: 1,
        min: 0,
        label: "SdS.SpellLevel",
      }),
      schools: new foundry.data.fields.ArrayField(
        new foundry.data.fields.StringField(),
        {
          required: true,
          nullable: true,
          initial: null,
          label: "SdS.SpellSchool",
        }
      ),
      elements: new foundry.data.fields.ArrayField(
        new foundry.data.fields.StringField(),
        {
          required: true,
          nullable: true,
          initial: null,
          label: "SdS.SpellElements",
        }
      ),
      components: new MappingField(new foundry.data.fields.BooleanField(), {
        required: true,
        label: "SdS.SpellComponents",
        initialKeys: [
          ...Object.keys(CONFIG.SdS.spellComponents),
          ...Object.keys(CONFIG.SdS.spellTags),
        ],
      }),
      mana: new foundry.data.fields.NumberField({
        required: true,
        integer: true,
        min: 0,
        label: "SdS.Mana",
      }),
      materials: new foundry.data.fields.SchemaField(
        {
          value: new foundry.data.fields.StringField({
            required: true,
            label: "SdS.SpellMaterialsDescription",
          }),
          consumed: new foundry.data.fields.BooleanField({
            required: true,
            label: "SdS.SpellMaterialsConsumed",
          }),
          cost: new foundry.data.fields.NumberField({
            required: true,
            initial: 0,
            min: 0,
            label: "SdS.SpellMaterialsCost",
          }),
          supply: new foundry.data.fields.NumberField({
            required: true,
            initial: 0,
            min: 0,
            label: "SdS.SpellMaterialsSupply",
          }),
        },
        { label: "SdS.SpellMaterials" }
      ),
      preparation: new foundry.data.fields.SchemaField(
        {
          mode: new foundry.data.fields.StringField({
            required: true,
            initial: "prepared",
            label: "SdS.SpellPreparationMode",
          }),
          prepared: new foundry.data.fields.BooleanField({
            required: true,
            label: "SdS.SpellPrepared",
          }),
        },
        { label: "SdS.SpellPreparation" }
      ),
      scaling: new foundry.data.fields.SchemaField(
        {
          mode: new foundry.data.fields.StringField({
            required: true,
            initial: "none",
            label: "SdS.ScalingMode",
          }),
          formula: new FormulaField({
            required: true,
            nullable: true,
            initial: null,
            label: "SdS.ScalingFormula",
          }),
        },
        { label: "SdS.LevelScaling" }
      ),
      tags: new foundry.data.fields.ArrayField(
        new foundry.data.fields.StringField(),
        {
          required: true,
          nullable: true,
          initial: null,
          label: "SdS.SpellTags",
        }
      ),
      classes: new foundry.data.fields.ArrayField(
        new foundry.data.fields.StringField(),
        {
          required: true,
          nullable: true,
          initial: null,
          label: "SdS.SpellClasses",
        }
      ),
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static migrateData(source) {
    super.migrateData(source);
    SpellData.#migrateComponentData(source);
    SpellData.#migrateScaling(source);
  }

  /* -------------------------------------------- */

  /**
   * Migrate the spell's component object to remove any old, non-boolean values.
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migrateComponentData(source) {
    if (!source.components) return;
    for (const [key, value] of Object.entries(source.components)) {
      if (typeof value !== "boolean") delete source.components[key];
    }
  }

  /* -------------------------------------------- */

  /**
   * Migrate spell scaling.
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migrateScaling(source) {
    if (!("scaling" in source)) return;
    if (source.scaling.mode === "" || source.scaling.mode === null)
      source.scaling.mode = "none";
  }
}

/**
 * Data definition for Subclass items.
 * @mixes ItemDescriptionTemplate
 *
 * @property {string} identifier       Identifier slug for this subclass.
 * @property {string} classIdentifier  Identifier slug for the class with which this subclass should be associated.
 * @property {object[]} advancement    Advancement objects for this subclass.
 * @property {object} spellcasting              Details on subclass's spellcasting ability.
 * @property {string} spellcasting.progression  Spell progression granted by class as from `SdS.spellProgression`.
 * @property {string} spellcasting.ability      Ability score to use for spellcasting.
 */
class SubclassData extends SystemDataModel.mixin(ItemDescriptionTemplate) {
  /** @inheritdoc */
  static defineSchema() {
    return this.mergeSchema(super.defineSchema(), {
      identifier: new IdentifierField({
        required: true,
        label: "SdS.Identifier",
      }),
      classIdentifier: new IdentifierField({
        required: true,
        label: "SdS.ClassIdentifier",
        hint: "SdS.ClassIdentifierHint",
      }),
      advancement: new foundry.data.fields.ArrayField(new AdvancementField(), {
        label: "SdS.AdvancementTitle",
      }),
      spellcasting: new foundry.data.fields.SchemaField(
        {
          progression: new foundry.data.fields.StringField({
            required: true,
            initial: "none",
            blank: false,
            label: "SdS.SpellProgression",
          }),
          ability: new foundry.data.fields.StringField({
            required: true,
            label: "SdS.SpellAbility",
          }),
        },
        { label: "SdS.Spellcasting" }
      ),
    });
  }
}

/**
 * Data definition for Tool items.
 * @mixes ItemDescriptionTemplate
 * @mixes PhysicalItemTemplate
 * @mixes EquippableItemTemplate
 *
 * @property {string} toolType    Tool category as defined in `SdS.toolTypes`.
 * @property {string} baseItem    Base tool as defined in `SdS.toolIds` for determining proficiency.
 * @property {string} ability     Default ability when this tool is being used.
 * @property {string} chatFlavor  Additional text added to chat when this tool is used.
 * @property {number} proficient  Level of proficiency in this tool as defined in `SdS.proficiencyLevels`.
 * @property {string} bonus       Bonus formula added to tool rolls.
 */
class ToolData extends SystemDataModel.mixin(
  ItemDescriptionTemplate,
  PhysicalItemTemplate,
  EquippableItemTemplate
) {
  /** @inheritdoc */
  static defineSchema() {
    return this.mergeSchema(super.defineSchema(), {
      toolType: new foundry.data.fields.StringField({
        required: true,
        label: "SdS.ItemToolType",
      }),
      baseItem: new foundry.data.fields.StringField({
        required: true,
        label: "SdS.ItemToolBase",
      }),
      ability: new foundry.data.fields.StringField({
        required: true,
        initial: "int",
        blank: false,
        label: "SdS.DefaultAbilityCheck",
      }),
      chatFlavor: new foundry.data.fields.StringField({
        required: true,
        label: "SdS.ChatFlavor",
      }),
      proficient: new foundry.data.fields.NumberField({
        required: true,
        nullable: false,
        initial: 0,
        min: 0,
        label: "SdS.ItemToolProficiency",
      }),
      bonus: new FormulaField({ required: true, label: "SdS.ItemToolBonus" }),
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static migrateData(source) {
    super.migrateData(source);
    ToolData.#migrateAbility(source);
  }

  /* -------------------------------------------- */

  /**
   * Migrate the ability field.
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migrateAbility(source) {
    if (Array.isArray(source.ability)) source.ability = source.ability[0];
  }
}

/**
 * Data definition for Weapon items.
 * @mixes ItemDescriptionTemplate
 * @mixes PhysicalItemTemplate
 * @mixes EquippableItemTemplate
 * @mixes ActivatedEffectTemplate
 * @mixes ActionTemplate
 * @mixes MountableTemplate
 *
 * @property {string} weaponType   Weapon category as defined in `SdS.weaponTypes`.
 * @property {string} baseItem     Base weapon as defined in `SdS.weaponIds` for determining proficiency.
 * @property {object} properties   Mapping of various weapon property booleans.
 * @property {boolean} proficient  Does the weapon's owner have proficiency?
 */
class WeaponData extends SystemDataModel.mixin(
  ItemDescriptionTemplate,
  PhysicalItemTemplate,
  EquippableItemTemplate,
  ActivatedEffectTemplate,
  ActionTemplate,
  MountableTemplate
) {
  /** @inheritdoc */
  static defineSchema() {
    return this.mergeSchema(super.defineSchema(), {
      weaponType: new foundry.data.fields.StringField({
        required: true,
        initial: "simpleM",
        label: "SdS.ItemWeaponType",
      }),
      baseItem: new foundry.data.fields.StringField({
        required: true,
        blank: true,
        label: "SdS.ItemWeaponBase",
      }),
      properties: new MappingField(new foundry.data.fields.BooleanField(), {
        required: true,
        initialKeys: CONFIG.SdS.weaponProperties,
        label: "SdS.ItemWeaponProperties",
      }),
      proficient: new foundry.data.fields.BooleanField({
        required: true,
        initial: true,
        label: "SdS.Proficient",
      }),
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static migrateData(source) {
    super.migrateData(source);
    WeaponData.#migratePropertiesData(source);
    WeaponData.#migrateProficient(source);
    WeaponData.#migrateWeaponType(source);
  }

  /* -------------------------------------------- */

  /**
   * Migrate the weapons's properties object to remove any old, non-boolean values.
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migratePropertiesData(source) {
    if (!source.properties) return;
    for (const [key, value] of Object.entries(source.properties)) {
      if (typeof value !== "boolean") delete source.properties[key];
    }
  }

  /* -------------------------------------------- */

  /**
   * Migrate the proficient field to remove non-boolean values.
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migrateProficient(source) {
    if (typeof source.proficient === "number")
      source.proficient = Boolean(source.proficient);
  }

  /* -------------------------------------------- */

  /**
   * Migrate the weapon type.
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migrateWeaponType(source) {
    if (source.weaponType === null) source.weaponType = "simpleM";
  }
}

const config$1 = {
  background: BackgroundData,
  backpack: ContainerData,
  class: ClassData,
  consumable: ConsumableData,
  equipment: EquipmentData,
  feat: FeatData,
  loot: LootData,
  spell: SpellData,
  subclass: SubclassData,
  tool: ToolData,
  weapon: WeaponData,
};

var _module$2 = /*#__PURE__*/ Object.freeze({
  __proto__: null,
  ActionTemplate: ActionTemplate,
  ActivatedEffectTemplate: ActivatedEffectTemplate,
  BackgroundData: BackgroundData,
  ClassData: ClassData,
  ConsumableData: ConsumableData,
  ContainerData: ContainerData,
  EquipmentData: EquipmentData,
  EquippableItemTemplate: EquippableItemTemplate,
  FeatData: FeatData,
  ItemDescriptionTemplate: ItemDescriptionTemplate,
  LootData: LootData,
  MountableTemplate: MountableTemplate,
  PhysicalItemTemplate: PhysicalItemTemplate,
  SpellData: SpellData,
  SubclassData: SubclassData,
  ToolData: ToolData,
  WeaponData: WeaponData,
  config: config$1,
});

/**
 * Data definition for Class Summary journal entry pages.
 *
 * @property {string} item                             UUID of the class item included.
 * @property {object} description
 * @property {string} description.value                Introductory description for the class.
 * @property {string} description.additionalHitPoints  Additional text displayed beneath the hit points section.
 * @property {string} description.additionalTraits     Additional text displayed beneath the traits section.
 * @property {string} description.additionalEquipment  Additional text displayed beneath the equipment section.
 * @property {string} description.subclass             Introduction to the subclass section.
 * @property {string} subclassHeader                   Subclass header to replace the default.
 * @property {Set<string>} subclassItems               UUIDs of all subclasses to display.
 */
class ClassJournalPageData extends foundry.abstract.DataModel {
  static defineSchema() {
    return {
      item: new foundry.data.fields.StringField({
        required: true,
        label: "JOURNALENTRYPAGE.SdS.Class.Item",
      }),
      description: new foundry.data.fields.SchemaField({
        value: new foundry.data.fields.HTMLField({
          label: "JOURNALENTRYPAGE.SdS.Class.Description",
          hint: "JOURNALENTRYPAGE.SdS.Class.DescriptionHint",
        }),
        additionalHitPoints: new foundry.data.fields.HTMLField({
          label: "JOURNALENTRYPAGE.SdS.Class.AdditionalHitPoints",
          hint: "JOURNALENTRYPAGE.SdS.Class.AdditionalHitPointsHint",
        }),
        additionalTraits: new foundry.data.fields.HTMLField({
          label: "JOURNALENTRYPAGE.SdS.Class.AdditionalTraits",
          hint: "JOURNALENTRYPAGE.SdS.Class.AdditionalTraitsHint",
        }),
        additionalEquipment: new foundry.data.fields.HTMLField({
          label: "JOURNALENTRYPAGE.SdS.Class.AdditionalEquipment",
          hint: "JOURNALENTRYPAGE.SdS.Class.AdditionalEquipmentHint",
        }),
        subclass: new foundry.data.fields.HTMLField({
          label: "JOURNALENTRYPAGE.SdS.Class.SubclassDescription",
          hint: "JOURNALENTRYPAGE.SdS.Class.SubclassDescriptionHint",
        }),
      }),
      subclassHeader: new foundry.data.fields.StringField({
        label: "JOURNALENTRYPAGE.SdS.Class.SubclassHeader",
      }),
      subclassItems: new foundry.data.fields.SetField(
        new foundry.data.fields.StringField(),
        {
          label: "JOURNALENTRYPAGE.SdS.Class.SubclassItems",
        }
      ),
    };
  }
}

const config = {
  class: ClassJournalPageData,
};

var _module$1 = /*#__PURE__*/ Object.freeze({
  __proto__: null,
  ClassJournalPageData: ClassJournalPageData,
  config: config,
});

var _module = /*#__PURE__*/ Object.freeze({
  __proto__: null,
  CurrencyTemplate: CurrencyTemplate,
});

var dataModels = /*#__PURE__*/ Object.freeze({
  __proto__: null,
  SystemDataModel: SystemDataModel,
  actor: _module$4,
  advancement: _module$3,
  fields: fields,
  item: _module$2,
  journal: _module$1,
  shared: _module,
});

/**
 * A type of Roll specific to a d20-based check, save, or attack roll in the 5e system.
 * @param {string} formula                       The string formula to parse
 * @param {object} data                          The data object against which to parse attributes within the formula
 * @param {object} [options={}]                  Extra optional arguments which describe or modify the D20Roll
 * @param {number} [options.advantageMode]       What advantage modifier to apply to the roll (none, advantage,
 *                                               disadvantage)
 * @param {number} [options.critical]            The value of d20 result which represents a critical success
 * @param {number} [options.fumble]              The value of d20 result which represents a critical failure
 * @param {(number)} [options.targetValue]       Assign a target value against which the result of this roll should be
 *                                               compared
 * @param {boolean} [options.elvenAccuracy=false]      Allow Elven Accuracy to modify this roll?
 * @param {boolean} [options.halflingLucky=false]      Allow Halfling Luck to modify this roll?
 * @param {boolean} [options.reliableTalent=false]     Allow Reliable Talent to modify this roll?
 */
class D20Roll extends Roll {
  constructor(formula, data, options) {
    super(formula, data, options);
    if (!this.options.configured) this.configureModifiers();
  }

  /* -------------------------------------------- */

  /**
   * Create a D20Roll from a standard Roll instance.
   * @param {Roll} roll
   * @returns {D20Roll}
   */
  static fromRoll(roll) {
    const newRoll = new this(roll.formula, roll.data, roll.options);
    Object.assign(newRoll, roll);
    return newRoll;
  }

  /* -------------------------------------------- */

  /**
   * Determine whether a d20 roll should be fast-forwarded, and whether advantage or disadvantage should be applied.
   * @param {object} [options]
   * @param {Event} [options.event]                               The Event that triggered the roll.
   * @param {boolean} [options.advantage]                         Is something granting this roll advantage?
   * @param {boolean} [options.disadvantage]                      Is something granting this roll disadvantage?
   * @param {boolean} [options.fastForward]                       Should the roll dialog be skipped?
   * @returns {{advantageMode: D20Roll.ADV_MODE, isFF: boolean}}  Whether the roll is fast-forwarded, and its advantage
   *                                                              mode.
   */
  static determineAdvantageMode({
    event,
    advantage = false,
    disadvantage = false,
    fastForward,
  } = {}) {
    const isFF =
      fastForward ??
      (event?.shiftKey || event?.altKey || event?.ctrlKey || event?.metaKey);
    let advantageMode = this.ADV_MODE.NORMAL;
    if (advantage || event?.altKey) advantageMode = this.ADV_MODE.ADVANTAGE;
    else if (disadvantage || event?.ctrlKey || event?.metaKey)
      advantageMode = this.ADV_MODE.DISADVANTAGE;
    return { isFF: !!isFF, advantageMode };
  }

  /* -------------------------------------------- */

  /**
   * Advantage mode of a 5e d20 roll
   * @enum {number}
   */
  static ADV_MODE = {
    NORMAL: 0,
    ADVANTAGE: 1,
    DISADVANTAGE: -1,
  };

  /* -------------------------------------------- */

  /**
   * The HTML template path used to configure evaluation of this Roll
   * @type {string}
   */
  static EVALUATION_TEMPLATE = "systems/sds/templates/chat/roll-dialog.hbs";

  /* -------------------------------------------- */

  /**
   * Does this roll start with a d20?
   * @type {boolean}
   */
  get validD20Roll() {
    return this.terms[0] instanceof Die && this.terms[0].faces === 20;
  }

  /* -------------------------------------------- */

  /**
   * A convenience reference for whether this D20Roll has advantage
   * @type {boolean}
   */
  get hasAdvantage() {
    return this.options.advantageMode === D20Roll.ADV_MODE.ADVANTAGE;
  }

  /* -------------------------------------------- */

  /**
   * A convenience reference for whether this D20Roll has disadvantage
   * @type {boolean}
   */
  get hasDisadvantage() {
    return this.options.advantageMode === D20Roll.ADV_MODE.DISADVANTAGE;
  }

  /* -------------------------------------------- */

  /**
   * Is this roll a critical success? Returns undefined if roll isn't evaluated.
   * @type {boolean|void}
   */
  get isCritical() {
    if (!this.validD20Roll || !this._evaluated) return undefined;
    if (!Number.isNumeric(this.options.critical)) return false;
    return this.dice[0].total >= this.options.critical;
  }

  /* -------------------------------------------- */

  /**
   * Is this roll a critical failure? Returns undefined if roll isn't evaluated.
   * @type {boolean|void}
   */
  get isFumble() {
    if (!this.validD20Roll || !this._evaluated) return undefined;
    if (!Number.isNumeric(this.options.fumble)) return false;
    return this.dice[0].total <= this.options.fumble;
  }

  /* -------------------------------------------- */
  /*  D20 Roll Methods                            */
  /* -------------------------------------------- */

  /**
   * Apply optional modifiers which customize the behavior of the d20term
   * @private
   */
  configureModifiers() {
    if (!this.validD20Roll) return;

    const d20 = this.terms[0];
    d20.modifiers = [];

    // Halfling Lucky
    if (this.options.halflingLucky) d20.modifiers.push("r1=1");

    // Reliable Talent
    if (this.options.reliableTalent) d20.modifiers.push("min10");

    // Handle Advantage or Disadvantage
    if (this.hasAdvantage) {
      d20.number = this.options.elvenAccuracy ? 3 : 2;
      d20.modifiers.push("kh");
      d20.options.advantage = true;
    } else if (this.hasDisadvantage) {
      d20.number = 2;
      d20.modifiers.push("kl");
      d20.options.disadvantage = true;
    } else d20.number = 1;

    // Assign critical and fumble thresholds
    if (this.options.critical) d20.options.critical = this.options.critical;
    if (this.options.fumble) d20.options.fumble = this.options.fumble;
    if (this.options.targetValue) d20.options.target = this.options.targetValue;

    // Re-compile the underlying formula
    this._formula = this.constructor.getFormula(this.terms);

    // Mark configuration as complete
    this.options.configured = true;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async toMessage(messageData = {}, options = {}) {
    // Evaluate the roll now so we have the results available to determine whether reliable talent came into play
    if (!this._evaluated) await this.evaluate({ async: true });

    // Add appropriate advantage mode message flavor and sds roll flags
    messageData.flavor = messageData.flavor || this.options.flavor;
    if (this.hasAdvantage)
      messageData.flavor += ` (${game.i18n.localize("SdS.Advantage")})`;
    else if (this.hasDisadvantage)
      messageData.flavor += ` (${game.i18n.localize("SdS.Disadvantage")})`;

    // Add reliable talent to the d20-term flavor text if it applied
    if (this.validD20Roll && this.options.reliableTalent) {
      const d20 = this.dice[0];
      const isRT = d20.results.every((r) => !r.active || r.result < 10);
      const label = `(${game.i18n.localize("SdS.FlagsReliableTalent")})`;
      if (isRT)
        d20.options.flavor = d20.options.flavor
          ? `${d20.options.flavor} (${label})`
          : label;
    }

    // Record the preferred rollMode
    options.rollMode = options.rollMode ?? this.options.rollMode;
    return super.toMessage(messageData, options);
  }

  /* -------------------------------------------- */
  /*  Configuration Dialog                        */
  /* -------------------------------------------- */

  /**
   * Create a Dialog prompt used to configure evaluation of an existing D20Roll instance.
   * @param {object} data                     Dialog configuration data
   * @param {string} [data.title]             The title of the shown dialog window
   * @param {number} [data.defaultRollMode]   The roll mode that the roll mode select element should default to
   * @param {number} [data.defaultAction]     The button marked as default
   * @param {boolean} [data.chooseModifier]   Choose which ability modifier should be applied to the roll?
   * @param {string} [data.defaultAbility]    For tool rolls, the default ability modifier applied to the roll
   * @param {string} [data.template]          A custom path to an HTML template to use instead of the default
   * @param {object} options                  Additional Dialog customization options
   * @returns {Promise<D20Roll|null>}         A resulting D20Roll object constructed with the dialog, or null if the
   *                                          dialog was closed
   */
  async configureDialog(
    {
      title,
      defaultRollMode,
      defaultAction = D20Roll.ADV_MODE.NORMAL,
      chooseModifier = false,
      defaultAbility,
      template,
    } = {},
    options = {}
  ) {
    // Render the Dialog inner HTML
    const content = await renderTemplate(
      template ?? this.constructor.EVALUATION_TEMPLATE,
      {
        formula: `${this.formula} + @bonus`,
        defaultRollMode,
        rollModes: CONFIG.Dice.rollModes,
        chooseModifier,
        defaultAbility,
        abilities: CONFIG.SdS.abilities,
      }
    );

    let defaultButton = "normal";
    switch (defaultAction) {
      case D20Roll.ADV_MODE.ADVANTAGE:
        defaultButton = "advantage";
        break;
      case D20Roll.ADV_MODE.DISADVANTAGE:
        defaultButton = "disadvantage";
        break;
    }

    // Create the Dialog window and await submission of the form
    return new Promise((resolve) => {
      new Dialog(
        {
          title,
          content,
          buttons: {
            advantage: {
              label: game.i18n.localize("SdS.Advantage"),
              callback: (html) =>
                resolve(this._onDialogSubmit(html, D20Roll.ADV_MODE.ADVANTAGE)),
            },
            normal: {
              label: game.i18n.localize("SdS.Normal"),
              callback: (html) =>
                resolve(this._onDialogSubmit(html, D20Roll.ADV_MODE.NORMAL)),
            },
            disadvantage: {
              label: game.i18n.localize("SdS.Disadvantage"),
              callback: (html) =>
                resolve(
                  this._onDialogSubmit(html, D20Roll.ADV_MODE.DISADVANTAGE)
                ),
            },
          },
          default: defaultButton,
          close: () => resolve(null),
        },
        options
      ).render(true);
    });
  }

  /* -------------------------------------------- */

  /**
   * Handle submission of the Roll evaluation configuration Dialog
   * @param {jQuery} html            The submitted dialog content
   * @param {number} advantageMode   The chosen advantage mode
   * @returns {D20Roll}              This damage roll.
   * @private
   */
  _onDialogSubmit(html, advantageMode) {
    const form = html[0].querySelector("form");

    // Append a situational bonus term
    if (form.bonus.value) {
      const bonus = new Roll(form.bonus.value, this.data);
      if (!(bonus.terms[0] instanceof OperatorTerm))
        this.terms.push(new OperatorTerm({ operator: "+" }));
      this.terms = this.terms.concat(bonus.terms);
    }

    // Customize the modifier
    if (form.ability?.value) {
      const abl = this.data.abilities[form.ability.value];
      this.terms = this.terms.flatMap((t) => {
        if (t.term === "@mod") return new NumericTerm({ number: abl.mod });
        if (t.term === "@abilityCheckBonus") {
          const bonus = abl.bonuses?.check;
          if (bonus) return new Roll(bonus, this.data).terms;
          return new NumericTerm({ number: 0 });
        }
        return t;
      });
      this.options.flavor += ` (${CONFIG.SdS.abilities[form.ability.value]})`;
    }

    // Apply advantage or disadvantage
    this.options.advantageMode = advantageMode;
    this.options.rollMode = form.rollMode.value;
    this.configureModifiers();
    return this;
  }
}

/**
 * A type of Roll specific to a damage (or healing) roll in the 5e system.
 * @param {string} formula                       The string formula to parse
 * @param {object} data                          The data object against which to parse attributes within the formula
 * @param {object} [options={}]                  Extra optional arguments which describe or modify the DamageRoll
 * @param {number} [options.criticalBonusDice=0]      A number of bonus damage dice that are added for critical hits
 * @param {number} [options.criticalMultiplier=2]     A critical hit multiplier which is applied to critical hits
 * @param {boolean} [options.multiplyNumeric=false]   Multiply numeric terms by the critical multiplier
 * @param {boolean} [options.powerfulCritical=false]  Apply the "powerful criticals" house rule to critical hits
 * @param {string} [options.criticalBonusDamage]      An extra damage term that is applied only on a critical hit
 */
class DamageRoll extends Roll {
  constructor(formula, data, options) {
    super(formula, data, options);
    if (!this.options.preprocessed) this.preprocessFormula();
    // For backwards compatibility, skip rolls which do not have the "critical" option defined
    if (this.options.critical !== undefined && !this.options.configured)
      this.configureDamage();
  }

  /* -------------------------------------------- */

  /**
   * Create a DamageRoll from a standard Roll instance.
   * @param {Roll} roll
   * @returns {DamageRoll}
   */
  static fromRoll(roll) {
    const newRoll = new this(roll.formula, roll.data, roll.options);
    Object.assign(newRoll, roll);
    return newRoll;
  }

  /* -------------------------------------------- */

  /**
   * The HTML template path used to configure evaluation of this Roll
   * @type {string}
   */
  static EVALUATION_TEMPLATE = "systems/sds/templates/chat/roll-dialog.hbs";

  /* -------------------------------------------- */

  /**
   * A convenience reference for whether this DamageRoll is a critical hit
   * @type {boolean}
   */
  get isCritical() {
    return this.options.critical;
  }

  /* -------------------------------------------- */
  /*  Damage Roll Methods                         */
  /* -------------------------------------------- */

  /**
   * Perform any term-merging required to ensure that criticals can be calculated successfully.
   * @protected
   */
  preprocessFormula() {
    for (let [i, term] of this.terms.entries()) {
      const nextTerm = this.terms[i + 1];
      const prevTerm = this.terms[i - 1];

      // Convert shorthand dX terms to 1dX preemptively to allow them to be appropriately doubled for criticals
      if (
        term instanceof StringTerm &&
        /^d\d+/.test(term.term) &&
        !(prevTerm instanceof ParentheticalTerm)
      ) {
        const formula = `1${term.term}`;
        const newTerm = new Roll(formula).terms[0];
        this.terms.splice(i, 1, newTerm);
        term = newTerm;
      }

      // Merge parenthetical terms that follow string terms to build a dice term (to allow criticals)
      else if (
        term instanceof ParentheticalTerm &&
        prevTerm instanceof StringTerm &&
        prevTerm.term.match(/^[0-9]*d$/)
      ) {
        if (term.isDeterministic) {
          let newFormula = `${prevTerm.term}${term.evaluate().total}`;
          let deleteCount = 2;

          // Merge in any roll modifiers
          if (nextTerm instanceof StringTerm) {
            newFormula += nextTerm.term;
            deleteCount += 1;
          }

          const newTerm = new Roll(newFormula).terms[0];
          this.terms.splice(i - 1, deleteCount, newTerm);
          term = newTerm;
        }
      }

      // Merge any parenthetical terms followed by string terms
      else if (
        (term instanceof ParentheticalTerm || term instanceof MathTerm) &&
        nextTerm instanceof StringTerm &&
        nextTerm.term.match(/^d[0-9]*$/)
      ) {
        if (term.isDeterministic) {
          const newFormula = `${term.evaluate().total}${nextTerm.term}`;
          const newTerm = new Roll(newFormula).terms[0];
          this.terms.splice(i, 2, newTerm);
          term = newTerm;
        }
      }
    }

    // Re-compile the underlying formula
    this._formula = this.constructor.getFormula(this.terms);

    // Mark configuration as complete
    this.options.preprocessed = true;
  }

  /* -------------------------------------------- */

  /**
   * Apply optional modifiers which customize the behavior of the d20term.
   * @protected
   */
  configureDamage() {
    let flatBonus = 0;
    for (let [i, term] of this.terms.entries()) {
      // Multiply dice terms
      if (term instanceof DiceTerm) {
        term.options.baseNumber = term.options.baseNumber ?? term.number; // Reset back
        term.number = term.options.baseNumber;
        if (this.isCritical) {
          let cm = this.options.criticalMultiplier ?? 2;

          // Powerful critical - maximize damage and reduce the multiplier by 1
          if (this.options.powerfulCritical) {
            flatBonus += term.number * term.faces;
            cm = Math.max(1, cm - 1);
          }

          // Alter the damage term
          let cb =
            this.options.criticalBonusDice && i === 0
              ? this.options.criticalBonusDice
              : 0;
          term.alter(cm, cb);
          term.options.critical = true;
        }
      }

      // Multiply numeric terms
      else if (this.options.multiplyNumeric && term instanceof NumericTerm) {
        term.options.baseNumber = term.options.baseNumber ?? term.number; // Reset back
        term.number = term.options.baseNumber;
        if (this.isCritical) {
          term.number *= this.options.criticalMultiplier ?? 2;
          term.options.critical = true;
        }
      }
    }

    // Add powerful critical bonus
    if (this.options.powerfulCritical && flatBonus > 0) {
      this.terms.push(new OperatorTerm({ operator: "+" }));
      this.terms.push(
        new NumericTerm(
          { number: flatBonus },
          { flavor: game.i18n.localize("SdS.PowerfulCritical") }
        )
      );
    }

    // Add extra critical damage term
    if (this.isCritical && this.options.criticalBonusDamage) {
      const extra = new Roll(this.options.criticalBonusDamage, this.data);
      if (!(extra.terms[0] instanceof OperatorTerm))
        this.terms.push(new OperatorTerm({ operator: "+" }));
      this.terms.push(...extra.terms);
    }

    // Re-compile the underlying formula
    this._formula = this.constructor.getFormula(this.terms);

    // Mark configuration as complete
    this.options.configured = true;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  toMessage(messageData = {}, options = {}) {
    messageData.flavor = messageData.flavor || this.options.flavor;
    if (this.isCritical) {
      const label = game.i18n.localize("SdS.CriticalHit");
      messageData.flavor = messageData.flavor
        ? `${messageData.flavor} (${label})`
        : label;
    }
    options.rollMode = options.rollMode ?? this.options.rollMode;
    return super.toMessage(messageData, options);
  }

  /* -------------------------------------------- */
  /*  Configuration Dialog                        */
  /* -------------------------------------------- */

  /**
   * Create a Dialog prompt used to configure evaluation of an existing D20Roll instance.
   * @param {object} data                     Dialog configuration data
   * @param {string} [data.title]               The title of the shown dialog window
   * @param {number} [data.defaultRollMode]     The roll mode that the roll mode select element should default to
   * @param {string} [data.defaultCritical]     Should critical be selected as default
   * @param {string} [data.template]            A custom path to an HTML template to use instead of the default
   * @param {boolean} [data.allowCritical=true] Allow critical hit to be chosen as a possible damage mode
   * @param {object} options                  Additional Dialog customization options
   * @returns {Promise<D20Roll|null>}         A resulting D20Roll object constructed with the dialog, or null if the
   *                                          dialog was closed
   */
  async configureDialog(
    {
      title,
      defaultRollMode,
      defaultCritical = false,
      template,
      allowCritical = true,
    } = {},
    options = {}
  ) {
    // Render the Dialog inner HTML
    const content = await renderTemplate(
      template ?? this.constructor.EVALUATION_TEMPLATE,
      {
        formula: `${this.formula} + @bonus`,
        defaultRollMode,
        rollModes: CONFIG.Dice.rollModes,
      }
    );

    // Create the Dialog window and await submission of the form
    return new Promise((resolve) => {
      new Dialog(
        {
          title,
          content,
          buttons: {
            critical: {
              condition: allowCritical,
              label: game.i18n.localize("SdS.CriticalHit"),
              callback: (html) => resolve(this._onDialogSubmit(html, true)),
            },
            normal: {
              label: game.i18n.localize(
                allowCritical ? "SdS.Normal" : "SdS.Roll"
              ),
              callback: (html) => resolve(this._onDialogSubmit(html, false)),
            },
          },
          default: defaultCritical ? "critical" : "normal",
          close: () => resolve(null),
        },
        options
      ).render(true);
    });
  }

  /* -------------------------------------------- */

  /**
   * Handle submission of the Roll evaluation configuration Dialog
   * @param {jQuery} html         The submitted dialog content
   * @param {boolean} isCritical  Is the damage a critical hit?
   * @returns {DamageRoll}        This damage roll.
   * @private
   */
  _onDialogSubmit(html, isCritical) {
    const form = html[0].querySelector("form");

    // Append a situational bonus term
    if (form.bonus.value) {
      const bonus = new DamageRoll(form.bonus.value, this.data);
      if (!(bonus.terms[0] instanceof OperatorTerm))
        this.terms.push(new OperatorTerm({ operator: "+" }));
      this.terms = this.terms.concat(bonus.terms);
    }

    // Apply advantage or disadvantage
    this.options.critical = isCritical;
    this.options.rollMode = form.rollMode.value;
    this.configureDamage();
    return this;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static fromData(data) {
    const roll = super.fromData(data);
    roll._formula = this.getFormula(roll.terms);
    return roll;
  }
}

var dice = /*#__PURE__*/ Object.freeze({
  __proto__: null,
  D20Roll: D20Roll,
  DamageRoll: DamageRoll,
  d20Roll: d20Roll,
  damageRoll: damageRoll,
  simplifyRollFormula: simplifyRollFormula,
});

/**
 * Extend the base TokenDocument class to implement system-specific HP bar logic.
 */
class TokenDocument5e extends TokenDocument {
  /** @inheritdoc */
  getBarAttribute(...args) {
    const data = super.getBarAttribute(...args);
    if (data && data.attribute === "attributes.hp") {
      const hp = this.actor.system.attributes.hp || {};
      data.value += hp.temp || 0;
      data.max += hp.tempmax || 0;
    }
    return data;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static getTrackedAttributes(data, _path = []) {
    if (data instanceof foundry.abstract.DataModel)
      return this._getTrackedAttributesFromSchema(data.schema, _path);
    const attributes = super.getTrackedAttributes(data, _path);
    if (_path.length) return attributes;
    const allowed = CONFIG.SdS.trackableAttributes;
    attributes.value = attributes.value.filter((attrs) =>
      this._isAllowedAttribute(allowed, attrs)
    );
    return attributes;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static _getTrackedAttributesFromSchema(schema, _path = []) {
    const isSchema = (field) =>
      field instanceof foundry.data.fields.SchemaField;
    const isModel = (field) =>
      field instanceof foundry.data.fields.EmbeddedDataField;
    const attributes = { bar: [], value: [] };
    for (const [name, field] of Object.entries(schema.fields)) {
      const p = _path.concat([name]);
      if (field instanceof foundry.data.fields.NumberField)
        attributes.value.push(p);
      if (isSchema(field) || isModel(field)) {
        const schema = isModel(field) ? field.model.schema : field;
        const isBar = schema.has("value") && schema.has("max");
        if (isBar) attributes.bar.push(p);
        else {
          const inner = this._getTrackedAttributesFromSchema(schema, p);
          attributes.bar.push(...inner.bar);
          attributes.value.push(...inner.value);
        }
      }
      if (!(field instanceof MappingField)) continue;
      if (foundry.utils.isEmpty(field.initialKeys)) continue;
      if (!isSchema(field.model) && !isModel(field.model)) continue;
      const keys = Array.isArray(field.initialKeys)
        ? field.initialKeys
        : Object.keys(field.initialKeys);
      for (const key of keys) {
        const inner = this._getTrackedAttributesFromSchema(
          field.model,
          p.concat([key])
        );
        attributes.bar.push(...inner.bar);
        attributes.value.push(...inner.value);
      }
    }
    return attributes;
  }

  /* -------------------------------------------- */

  /**
   * Get an Array of attribute choices which are suitable for being consumed by an item usage.
   * @param {object} data  The actor data.
   * @returns {{bar: string[], value: string[]}}
   */
  static getConsumedAttributes(data) {
    const attributes = super.getTrackedAttributes(data);
    const allowed = CONFIG.SdS.consumableResources;
    attributes.value = attributes.value.filter((attrs) =>
      this._isAllowedAttribute(allowed, attrs)
    );
    return attributes;
  }

  /* -------------------------------------------- */

  /**
   * Traverse the configured allowed attributes to see if the provided one matches.
   * @param {object} allowed  The allowed attributes structure.
   * @param {string[]} attrs  The attributes list to test.
   * @returns {boolean}       Whether the given attribute is allowed.
   * @private
   */
  static _isAllowedAttribute(allowed, attrs) {
    let allow = allowed;
    for (const attr of attrs) {
      if (allow === undefined) return false;
      if (allow === true) return true;
      if (allow["*"] !== undefined) allow = allow["*"];
      else allow = allow[attr];
    }
    return allow !== undefined;
  }
}

/**
 * Highlight critical success or failure on d20 rolls.
 * @param {ChatMessage} message  Message being prepared.
 * @param {HTMLElement} html     Rendered contents of the message.
 * @param {object} data          Configuration data passed to the message.
 */
function highlightCriticalSuccessFailure(message, html, data) {
  if (!message.isRoll || !message.isContentVisible || !message.rolls.length)
    return;

  // Highlight rolls where the first part is a d20 roll
  let d20Roll = message.rolls.find((r) => {
    const d0 = r.dice[0];
    return d0?.faces === 20 && d0?.values.length === 1;
  });
  if (!d20Roll) return;
  d20Roll = sds.dice.D20Roll.fromRoll(d20Roll);
  const d = d20Roll.dice[0];

  const isModifiedRoll =
    "success" in d.results[0] ||
    d.options.marginSuccess ||
    d.options.marginFailure;
  if (isModifiedRoll) return;

  // Highlight successes and failures
  if (d20Roll.isCritical) html.find(".dice-total").addClass("critical");
  else if (d20Roll.isFumble) html.find(".dice-total").addClass("fumble");
  else if (d.options.target) {
    if (d20Roll.total >= d.options.target)
      html.find(".dice-total").addClass("success");
    else html.find(".dice-total").addClass("failure");
  }
}

/* -------------------------------------------- */

/**
 * Optionally hide the display of chat card action buttons which cannot be performed by the user
 * @param {ChatMessage} message  Message being prepared.
 * @param {HTMLElement} html     Rendered contents of the message.
 * @param {object} data          Configuration data passed to the message.
 */
function displayChatActionButtons(message, html, data) {
  const chatCard = html.find(".sds.chat-card");
  if (chatCard.length > 0) {
    const flavor = html.find(".flavor-text");
    if (flavor.text() === html.find(".item-name").text()) flavor.remove();

    // If the user is the message author or the actor owner, proceed
    let actor = game.actors.get(data.message.speaker.actor);
    if (actor && actor.isOwner) return;
    else if (game.user.isGM || data.author.id === game.user.id) return;

    // Otherwise conceal action buttons except for saving throw
    const buttons = chatCard.find("button[data-action]");
    buttons.each((i, btn) => {
      if (btn.dataset.action === "save") return;
      btn.style.display = "none";
    });
  }
}

/* -------------------------------------------- */

/**
 * This function is used to hook into the Chat Log context menu to add additional options to each message
 * These options make it easy to conveniently apply damage to controlled tokens based on the value of a Roll
 *
 * @param {HTMLElement} html    The Chat Message being rendered
 * @param {object[]} options    The Array of Context Menu options
 *
 * @returns {object[]}          The extended options Array including new context choices
 */
function addChatMessageContextOptions(html, options) {
  let canApply = (li) => {
    const message = game.messages.get(li.data("messageId"));
    return (
      message?.isRoll &&
      message?.isContentVisible &&
      canvas.tokens?.controlled.length
    );
  };
  options.push(
    {
      name: game.i18n.localize("SdS.ChatContextDamage"),
      icon: '<i class="fas fa-user-minus"></i>',
      condition: canApply,
      callback: (li) => applyChatCardDamage(li, 1),
    },
    {
      name: game.i18n.localize("SdS.ChatContextHealing"),
      icon: '<i class="fas fa-user-plus"></i>',
      condition: canApply,
      callback: (li) => applyChatCardDamage(li, -1),
    },
    {
      name: game.i18n.localize("SdS.ChatContextTempHP"),
      icon: '<i class="fas fa-user-clock"></i>',
      condition: canApply,
      callback: (li) => applyChatCardTemp(li),
    },
    {
      name: game.i18n.localize("SdS.ChatContextDoubleDamage"),
      icon: '<i class="fas fa-user-injured"></i>',
      condition: canApply,
      callback: (li) => applyChatCardDamage(li, 2),
    },
    {
      name: game.i18n.localize("SdS.ChatContextHalfDamage"),
      icon: '<i class="fas fa-user-shield"></i>',
      condition: canApply,
      callback: (li) => applyChatCardDamage(li, 0.5),
    }
  );
  return options;
}

/* -------------------------------------------- */

/**
 * Apply rolled dice damage to the token or tokens which are currently controlled.
 * This allows for damage to be scaled by a multiplier to account for healing, critical hits, or resistance
 *
 * @param {HTMLElement} li      The chat entry which contains the roll data
 * @param {number} multiplier   A damage multiplier to apply to the rolled damage.
 * @returns {Promise}
 */
function applyChatCardDamage(li, multiplier) {
  const message = game.messages.get(li.data("messageId"));
  const roll = message.rolls[0];
  return Promise.all(
    canvas.tokens.controlled.map((t) => {
      const a = t.actor;
      return a.applyDamage(roll.total, multiplier);
    })
  );
}

/* -------------------------------------------- */

/**
 * Apply rolled dice as temporary hit points to the controlled token(s).
 * @param {HTMLElement} li  The chat entry which contains the roll data
 * @returns {Promise}
 */
function applyChatCardTemp(li) {
  const message = game.messages.get(li.data("messageId"));
  const roll = message.rolls[0];
  return Promise.all(
    canvas.tokens.controlled.map((t) => {
      const a = t.actor;
      return a.applyTempHP(roll.total);
    })
  );
}

/* -------------------------------------------- */

/**
 * Handle rendering of a chat message to the log
 * @param {ChatLog} app     The ChatLog instance
 * @param {jQuery} html     Rendered chat message HTML
 * @param {object} data     Data passed to the render context
 */
function onRenderChatMessage(app, html, data) {
  displayChatActionButtons(app, html, data);
  highlightCriticalSuccessFailure(app, html);
  if (game.settings.get("sds", "autoCollapseItemCards"))
    html.find(".card-content").hide();
}

var chatMessage = /*#__PURE__*/ Object.freeze({
  __proto__: null,
  addChatMessageContextOptions: addChatMessageContextOptions,
  displayChatActionButtons: displayChatActionButtons,
  highlightCriticalSuccessFailure: highlightCriticalSuccessFailure,
  onRenderChatMessage: onRenderChatMessage,
});

/**
 * Override the core method for obtaining a Roll instance used for the Combatant.
 * @see {Actor5e#getInitiativeRoll}
 * @param {string} [formula]  A formula to use if no Actor is defined
 * @returns {D20Roll}         The D20Roll instance which is used to determine initiative for the Combatant
 */
function getInitiativeRoll(formula = "1d20") {
  if (!this.actor) return CONFIG.Dice.D20Roll(formula, {});
  return this.actor.getInitiativeRoll();
}

var combat = /*#__PURE__*/ Object.freeze({
  __proto__: null,
  getInitiativeRoll: getInitiativeRoll,
});

/**
 * Attempt to create a macro from the dropped data. Will use an existing macro if one exists.
 * @param {object} dropData     The dropped data
 * @param {number} slot         The hotbar slot to use
 */
async function create5eMacro(dropData, slot) {
  const macroData = { type: "script", scope: "actor" };
  switch (dropData.type) {
    case "Item":
      const itemData = await Item.implementation.fromDropData(dropData);
      if (!itemData)
        return ui.notifications.warn(game.i18n.localize("MACRO.5eUnownedWarn"));
      foundry.utils.mergeObject(macroData, {
        name: itemData.name,
        img: itemData.img,
        command: `sds.documents.macro.rollItem("${itemData.name}")`,
        flags: { "sds.itemMacro": true },
      });
      break;
    case "ActiveEffect":
      const effectData = await ActiveEffect.implementation.fromDropData(
        dropData
      );
      if (!effectData)
        return ui.notifications.warn(game.i18n.localize("MACRO.5eUnownedWarn"));
      foundry.utils.mergeObject(macroData, {
        name: effectData.label,
        img: effectData.icon,
        command: `sds.documents.macro.toggleEffect("${effectData.label}")`,
        flags: { "sds.effectMacro": true },
      });
      break;
    default:
      return;
  }

  // Assign the macro to the hotbar
  const macro =
    game.macros.find(
      (m) =>
        m.name === macroData.name &&
        m.command === macroData.command &&
        m.author.isSelf
    ) || (await Macro.create(macroData));
  game.user.assignHotbarMacro(macro, slot);
}

/* -------------------------------------------- */

/**
 * Find a document of the specified name and type on an assigned or selected actor.
 * @param {string} name          Document name to locate.
 * @param {string} documentType  Type of embedded document (e.g. "Item" or "ActiveEffect").
 * @returns {Document}           Document if found, otherwise nothing.
 */
function getMacroTarget(name, documentType) {
  let actor;
  const speaker = ChatMessage.getSpeaker();
  if (speaker.token) actor = game.actors.tokens[speaker.token];
  actor ??= game.actors.get(speaker.actor);
  if (!actor)
    return ui.notifications.warn(game.i18n.localize("MACRO.5eNoActorSelected"));

  const collection = documentType === "Item" ? actor.items : actor.effects;
  const nameKeyPath = documentType === "Item" ? "name" : "label";

  // Find item in collection
  const documents = collection.filter(
    (i) => foundry.utils.getProperty(i, nameKeyPath) === name
  );
  const type = game.i18n.localize(`DOCUMENT.${documentType}`);
  if (documents.length === 0) {
    return ui.notifications.warn(
      game.i18n.format("MACRO.5eMissingTargetWarn", {
        actor: actor.name,
        type,
        name,
      })
    );
  }
  if (documents.length > 1) {
    ui.notifications.warn(
      game.i18n.format("MACRO.5eMultipleTargetsWarn", {
        actor: actor.name,
        type,
        name,
      })
    );
  }
  return documents[0];
}

/* -------------------------------------------- */

/**
 * Trigger an item to roll when a macro is clicked.
 * @param {string} itemName                Name of the item on the selected actor to trigger.
 * @returns {Promise<ChatMessage|object>}  Roll result.
 */
function rollItem(itemName) {
  return getMacroTarget(itemName, "Item")?.use();
}

/* -------------------------------------------- */

/**
 * Toggle an effect on and off when a macro is clicked.
 * @param {string} effectLabel       Label for the effect to be toggled.
 * @returns {Promise<ActiveEffect>}  The effect after it has been toggled.
 */
function toggleEffect(effectLabel) {
  const effect = getMacroTarget(effectLabel, "ActiveEffect");
  return effect?.update({ disabled: !effect.disabled });
}

var macro = /*#__PURE__*/ Object.freeze({
  __proto__: null,
  create5eMacro: create5eMacro,
  rollItem: rollItem,
  toggleEffect: toggleEffect,
});

// Document Classes

var documents = /*#__PURE__*/ Object.freeze({
  __proto__: null,
  ActiveEffect5e: ActiveEffect5e,
  Actor5e: Actor5e,
  Item5e: Item5e,
  Proficiency: Proficiency,
  TokenDocument5e: TokenDocument5e,
  Trait: trait,
  advancement: _module$a,
  chat: chatMessage,
  combat: combat,
  macro: macro,
});

/**
 * Perform a system migration for the entire World, applying migrations for Actors, Items, and Compendium packs
 * @returns {Promise}      A Promise which resolves once the migration is completed
 */
const migrateWorld = async function () {
  const version = game.system.version;
  ui.notifications.info(game.i18n.format("MIGRATION.5eBegin", { version }), {
    permanent: true,
  });

  const migrationData = await getMigrationData();

  // Migrate World Actors
  const actors = game.actors
    .map((a) => [a, true])
    .concat(
      Array.from(game.actors.invalidDocumentIds).map((id) => [
        game.actors.getInvalid(id),
        false,
      ])
    );
  for (const [actor, valid] of actors) {
    try {
      const source = valid
        ? actor.toObject()
        : game.data.actors.find((a) => a._id === actor.id);
      const updateData = migrateActorData(source, migrationData);
      if (!foundry.utils.isEmpty(updateData)) {
        console.log(`Migrating Actor document ${actor.name}`);
        await actor.update(updateData, { enforceTypes: false, diff: valid });
      }
    } catch (err) {
      err.message = `Failed sds system migration for Actor ${actor.name}: ${err.message}`;
      console.error(err);
    }
  }

  // Migrate World Items
  const items = game.items
    .map((i) => [i, true])
    .concat(
      Array.from(game.items.invalidDocumentIds).map((id) => [
        game.items.getInvalid(id),
        false,
      ])
    );
  for (const [item, valid] of items) {
    try {
      const source = valid
        ? item.toObject()
        : game.data.items.find((i) => i._id === item.id);
      const updateData = migrateItemData(source, migrationData);
      if (!foundry.utils.isEmpty(updateData)) {
        console.log(`Migrating Item document ${item.name}`);
        await item.update(updateData, { enforceTypes: false, diff: valid });
      }
    } catch (err) {
      err.message = `Failed sds system migration for Item ${item.name}: ${err.message}`;
      console.error(err);
    }
  }

  // Migrate World Macros
  for (const m of game.macros) {
    try {
      const updateData = migrateMacroData(m.toObject(), migrationData);
      if (!foundry.utils.isEmpty(updateData)) {
        console.log(`Migrating Macro document ${m.name}`);
        await m.update(updateData, { enforceTypes: false });
      }
    } catch (err) {
      err.message = `Failed sds system migration for Macro ${m.name}: ${err.message}`;
      console.error(err);
    }
  }

  // Migrate Actor Override Tokens
  for (let s of game.scenes) {
    try {
      const updateData = migrateSceneData(s, migrationData);
      if (!foundry.utils.isEmpty(updateData)) {
        console.log(`Migrating Scene document ${s.name}`);
        await s.update(updateData, { enforceTypes: false });
        // If we do not do this, then synthetic token actors remain in cache
        // with the un-updated actorData.
        s.tokens.forEach((t) => (t._actor = null));
      }
    } catch (err) {
      err.message = `Failed sds system migration for Scene ${s.name}: ${err.message}`;
      console.error(err);
    }
  }

  // Migrate World Compendium Packs
  for (let p of game.packs) {
    if (p.metadata.packageType !== "world") continue;
    if (!["Actor", "Item", "Scene"].includes(p.documentName)) continue;
    await migrateCompendium(p);
  }

  // Set the migration as complete
  game.settings.set("sds", "systemMigrationVersion", game.system.version);
  ui.notifications.info(game.i18n.format("MIGRATION.5eComplete", { version }), {
    permanent: true,
  });
};

/* -------------------------------------------- */

/**
 * Apply migration rules to all Documents within a single Compendium pack
 * @param {CompendiumCollection} pack  Pack to be migrated.
 * @returns {Promise}
 */
const migrateCompendium = async function (pack) {
  const documentName = pack.documentName;
  if (!["Actor", "Item", "Scene"].includes(documentName)) return;

  const migrationData = await getMigrationData();

  // Unlock the pack for editing
  const wasLocked = pack.locked;
  await pack.configure({ locked: false });

  // Begin by requesting server-side data model migration and get the migrated content
  await pack.migrate();
  const documents = await pack.getDocuments();

  // Iterate over compendium entries - applying fine-tuned migration functions
  for (let doc of documents) {
    let updateData = {};
    try {
      switch (documentName) {
        case "Actor":
          updateData = migrateActorData(doc.toObject(), migrationData);
          break;
        case "Item":
          updateData = migrateItemData(doc.toObject(), migrationData);
          break;
        case "Scene":
          updateData = migrateSceneData(doc.toObject(), migrationData);
          break;
      }

      // Save the entry, if data was changed
      if (foundry.utils.isEmpty(updateData)) continue;
      await doc.update(updateData);
      console.log(
        `Migrated ${documentName} document ${doc.name} in Compendium ${pack.collection}`
      );
    } catch (err) {
      // Handle migration failures
      err.message = `Failed sds system migration for document ${doc.name} in pack ${pack.collection}: ${err.message}`;
      console.error(err);
    }
  }

  // Apply the original locked status for the pack
  await pack.configure({ locked: wasLocked });
  console.log(
    `Migrated all ${documentName} documents from Compendium ${pack.collection}`
  );
};

/* -------------------------------------------- */

/**
 * Update all compendium packs using the new system data model.
 */
async function refreshAllCompendiums() {
  for (const pack of game.packs) {
    await refreshCompendium(pack);
  }
}

/* -------------------------------------------- */

/**
 * Update all Documents in a compendium using the new system data model.
 * @param {CompendiumCollection} pack  Pack to refresh.
 */
async function refreshCompendium(pack) {
  if (!pack?.documentName) return;
  sds.moduleArt.suppressArt = true;
  const DocumentClass = CONFIG[pack.documentName].documentClass;
  const wasLocked = pack.locked;
  await pack.configure({ locked: false });
  await pack.migrate();

  ui.notifications.info(`Beginning to refresh Compendium ${pack.collection}`);
  const documents = await pack.getDocuments();
  for (const doc of documents) {
    const data = doc.toObject();
    await doc.delete();
    await DocumentClass.create(data, {
      keepId: true,
      keepEmbeddedIds: true,
      pack: pack.collection,
    });
  }
  await pack.configure({ locked: wasLocked });
  sds.moduleArt.suppressArt = false;
  ui.notifications.info(
    `Refreshed all documents from Compendium ${pack.collection}`
  );
}

/* -------------------------------------------- */

/**
 * Apply 'smart' AC migration to a given Actor compendium. This will perform the normal AC migration but additionally
 * check to see if the actor has armor already equipped, and opt to use that instead.
 * @param {CompendiumCollection|string} pack  Pack or name of pack to migrate.
 * @returns {Promise}
 */
const migrateArmorClass = async function (pack) {
  if (typeof pack === "string") pack = game.packs.get(pack);
  if (pack.documentName !== "Actor") return;
  const wasLocked = pack.locked;
  await pack.configure({ locked: false });
  const actors = await pack.getDocuments();
  const updates = [];
  const armor = new Set(Object.keys(CONFIG.SdS.armorTypes));

  for (const actor of actors) {
    try {
      console.log(`Migrating ${actor.name}...`);
      const src = actor.toObject();
      const update = { _id: actor.id };

      // Perform the normal migration.
      _migrateActorAC(src, update);
      // TODO: See if AC migration within DataModel is enough to handle this
      updates.push(update);

      // CASE 1: Armor is equipped
      const hasArmorEquipped = actor.itemTypes.equipment.some((e) => {
        return armor.has(e.system.armor?.type) && e.system.equipped;
      });
      if (hasArmorEquipped) update["system.attributes.ac.calc"] = "default";
      // CASE 2: NPC Natural Armor
      else if (src.type === "npc")
        update["system.attributes.ac.calc"] = "natural";
    } catch (e) {
      console.warn(`Failed to migrate armor class for Actor ${actor.name}`, e);
    }
  }

  await Actor.implementation.updateDocuments(updates, {
    pack: pack.collection,
  });
  await pack.getDocuments(); // Force a re-prepare of all actors.
  await pack.configure({ locked: wasLocked });
  console.log(
    `Migrated the AC of all Actors from Compendium ${pack.collection}`
  );
};

/* -------------------------------------------- */
/*  Document Type Migration Helpers             */
/* -------------------------------------------- */

/**
 * Migrate a single Actor document to incorporate latest data model changes
 * Return an Object of updateData to be applied
 * @param {object} actor            The actor data object to update
 * @param {object} [migrationData]  Additional data to perform the migration
 * @returns {object}                The updateData to apply
 */
const migrateActorData = function (actor, migrationData) {
  const updateData = {};
  _migrateTokenImage(actor, updateData);
  _migrateActorAC(actor, updateData);

  // Migrate embedded effects
  if (actor.effects) {
    const effects = migrateEffects(actor, migrationData);
    if (effects.length > 0) updateData.effects = effects;
  }

  // Migrate Owned Items
  if (!actor.items) return updateData;
  const items = actor.items.reduce((arr, i) => {
    // Migrate the Owned Item
    const itemData = i instanceof CONFIG.Item.documentClass ? i.toObject() : i;
    let itemUpdate = migrateItemData(itemData, migrationData);

    // Prepared, Equipped, and Proficient for NPC actors
    if (actor.type === "npc") {
      if (
        foundry.utils.getProperty(itemData.system, "preparation.prepared") ===
        false
      )
        itemUpdate["system.preparation.prepared"] = true;
      if (foundry.utils.getProperty(itemData.system, "equipped") === false)
        itemUpdate["system.equipped"] = true;
      if (foundry.utils.getProperty(itemData.system, "proficient") === false)
        itemUpdate["system.proficient"] = true;
    }

    // Update the Owned Item
    if (!foundry.utils.isEmpty(itemUpdate)) {
      itemUpdate._id = itemData._id;
      arr.push(foundry.utils.expandObject(itemUpdate));
    }

    return arr;
  }, []);
  if (items.length > 0) updateData.items = items;

  return updateData;
};

/* -------------------------------------------- */

/**
 * Migrate a single Item document to incorporate latest data model changes
 *
 * @param {object} item             Item data to migrate
 * @param {object} [migrationData]  Additional data to perform the migration
 * @returns {object}                The updateData to apply
 */
function migrateItemData(item, migrationData) {
  const updateData = {};
  _migrateDocumentIcon(item, updateData, migrationData);

  // Migrate embedded effects
  if (item.effects) {
    const effects = migrateEffects(item, migrationData);
    if (effects.length > 0) updateData.effects = effects;
  }

  return updateData;
}

/* -------------------------------------------- */

/**
 * Migrate any active effects attached to the provided parent.
 * @param {object} parent           Data of the parent being migrated.
 * @param {object} [migrationData]  Additional data to perform the migration.
 * @returns {object[]}              Updates to apply on the embedded effects.
 */
const migrateEffects = function (parent, migrationData) {
  if (!parent.effects) return {};
  return parent.effects.reduce((arr, e) => {
    const effectData =
      e instanceof CONFIG.ActiveEffect.documentClass ? e.toObject() : e;
    let effectUpdate = migrateEffectData(effectData, migrationData);
    if (!foundry.utils.isEmpty(effectUpdate)) {
      effectUpdate._id = effectData._id;
      arr.push(foundry.utils.expandObject(effectUpdate));
    }
    return arr;
  }, []);
};

/* -------------------------------------------- */

/**
 * Migrate the provided active effect data.
 * @param {object} effect           Effect data to migrate.
 * @param {object} [migrationData]  Additional data to perform the migration.
 * @returns {object}                The updateData to apply.
 */
const migrateEffectData = function (effect, migrationData) {
  const updateData = {};
  _migrateDocumentIcon(effect, updateData, { ...migrationData, field: "icon" });
  _migrateEffectArmorClass(effect, updateData);
  return updateData;
};

/* -------------------------------------------- */

/**
 * Migrate a single Macro document to incorporate latest data model changes.
 * @param {object} macro            Macro data to migrate
 * @param {object} [migrationData]  Additional data to perform the migration
 * @returns {object}                The updateData to apply
 */
const migrateMacroData = function (macro, migrationData) {
  const updateData = {};
  _migrateDocumentIcon(macro, updateData, migrationData);
  _migrateMacroCommands(macro, updateData);
  return updateData;
};

/* -------------------------------------------- */

/**
 * Migrate a single Scene document to incorporate changes to the data model of it's actor data overrides
 * Return an Object of updateData to be applied
 * @param {object} scene            The Scene data to Update
 * @param {object} [migrationData]  Additional data to perform the migration
 * @returns {object}                The updateData to apply
 */
const migrateSceneData = function (scene, migrationData) {
  const tokens = scene.tokens.map((token) => {
    const t =
      token instanceof foundry.abstract.DataModel ? token.toObject() : token;
    const update = {};
    _migrateTokenImage(t, update);
    if (Object.keys(update).length) foundry.utils.mergeObject(t, update);
    if (!t.actorId || t.actorLink) {
      t.actorData = {};
    } else if (!game.actors.has(t.actorId)) {
      t.actorId = null;
      t.actorData = {};
    } else if (!t.actorLink) {
      const actorData = duplicate(t.actorData);
      actorData.type = token.actor?.type;
      const update = migrateActorData(actorData, migrationData);
      ["items", "effects"].forEach((embeddedName) => {
        if (!update[embeddedName]?.length) return;
        const updates = new Map(update[embeddedName].map((u) => [u._id, u]));
        t.actorData[embeddedName].forEach((original) => {
          const update = updates.get(original._id);
          if (update) foundry.utils.mergeObject(original, update);
        });
        delete update[embeddedName];
      });

      foundry.utils.mergeObject(t.actorData, update);
    }
    return t;
  });
  return { tokens };
};

/* -------------------------------------------- */

/**
 * Fetch bundled data for large-scale migrations.
 * @returns {Promise<object>}  Object mapping original system icons to their core replacements.
 */
const getMigrationData = async function () {
  const data = {};
  try {
    const icons = await fetch("systems/sds/json/icon-migration.json");
    const spellIcons = await fetch(
      "systems/sds/json/spell-icon-migration.json"
    );
    data.iconMap = { ...(await icons.json()), ...(await spellIcons.json()) };
  } catch (err) {
    console.warn(`Failed to retrieve icon migration data: ${err.message}`);
  }
  return data;
};

/* -------------------------------------------- */
/*  Low level migration utilities
/* -------------------------------------------- */

/**
 * Migrate the actor attributes.ac.value to the new ac.flat override field.
 * @param {object} actorData   Actor data being migrated.
 * @param {object} updateData  Existing updates being applied to actor. *Will be mutated.*
 * @returns {object}           Modified version of update data.
 * @private
 */
function _migrateActorAC(actorData, updateData) {
  const ac = actorData.system?.attributes?.ac;
  // If the actor has a numeric ac.value, then their AC has not been migrated to the auto-calculation schema yet.
  if (Number.isNumeric(ac?.value)) {
    updateData["system.attributes.ac.flat"] = parseInt(ac.value);
    updateData["system.attributes.ac.calc"] =
      actorData.type === "npc" ? "natural" : "flat";
    updateData["system.attributes.ac.-=value"] = null;
    return updateData;
  }

  // Migrate ac.base in custom formulas to ac.armor
  if (
    typeof ac?.formula === "string" &&
    ac?.formula.includes("@attributes.ac.base")
  ) {
    updateData["system.attributes.ac.formula"] = ac.formula.replaceAll(
      "@attributes.ac.base",
      "@attributes.ac.armor"
    );
  }

  // Protect against string values created by character sheets or importers that don't enforce data types
  if (typeof ac?.flat === "string" && Number.isNumeric(ac.flat)) {
    updateData["system.attributes.ac.flat"] = parseInt(ac.flat);
  }

  // Remove invalid AC formula strings.
  if (ac?.formula) {
    try {
      const roll = new Roll(ac.formula);
      Roll.safeEval(roll.formula);
    } catch (e) {
      updateData["system.attributes.ac.formula"] = "";
    }
  }

  return updateData;
}

/* -------------------------------------------- */

/**
 * Migrate any system token images from PNG to WEBP.
 * @param {object} actorData    Actor or token data to migrate.
 * @param {object} updateData   Existing update to expand upon.
 * @returns {object}            The updateData to apply
 * @private
 */
function _migrateTokenImage(actorData, updateData) {
  const oldSystemPNG = /^systems\/sds\/tokens\/([a-z]+)\/([A-z]+).png$/;
  for (const path of ["texture.src", "prototypeToken.texture.src"]) {
    const v = foundry.utils.getProperty(actorData, path);
    if (oldSystemPNG.test(v)) {
      const [type, fileName] = v.match(oldSystemPNG).slice(1);
      updateData[path] = `systems/sds/tokens/${type}/${fileName}.webp`;
    }
  }
  return updateData;
}

/* -------------------------------------------- */

/**
 * Convert system icons to use bundled core webp icons.
 * @param {object} document                                 Document data to migrate
 * @param {object} updateData                               Existing update to expand upon
 * @param {object} [migrationData={}]                       Additional data to perform the migration
 * @param {Object<string, string>} [migrationData.iconMap]  A mapping of system icons to core foundry icons
 * @param {string} [migrationData.field]                    The document field to migrate
 * @returns {object}                                        The updateData to apply
 * @private
 */
function _migrateDocumentIcon(
  document,
  updateData,
  { iconMap, field = "img" } = {}
) {
  let path = document?.[field];
  if (path && iconMap) {
    if (path.startsWith("/") || path.startsWith("\\")) path = path.substring(1);
    const rename = iconMap[path];
    if (rename) updateData[field] = rename;
  }
  return updateData;
}

/* -------------------------------------------- */

/**
 * Change active effects that target AC.
 * @param {object} effect      Effect data to migrate.
 * @param {object} updateData  Existing update to expand upon.
 * @returns {object}           The updateData to apply.
 */
function _migrateEffectArmorClass(effect, updateData) {
  let containsUpdates = false;
  const changes = (effect.changes || []).map((c) => {
    if (c.key !== "system.attributes.ac.base") return c;
    c.key = "system.attributes.ac.armor";
    containsUpdates = true;
    return c;
  });
  if (containsUpdates) updateData.changes = changes;
  return updateData;
}

/* -------------------------------------------- */

/**
 * Migrate macros from the old 'sds.rollItemMacro' and 'sds.macros' commands to the new location.
 * @param {object} macro       Macro data to migrate.
 * @param {object} updateData  Existing update to expand upon.
 * @returns {object}           The updateData to apply.
 */
function _migrateMacroCommands(macro, updateData) {
  if (macro.command.includes("game.sds.rollItemMacro")) {
    updateData.command = macro.command.replaceAll(
      "game.sds.rollItemMacro",
      "sds.documents.macro.rollItem"
    );
  } else if (macro.command.includes("game.sds.macros.")) {
    updateData.command = macro.command.replaceAll(
      "game.sds.macros.",
      "sds.documents.macro."
    );
  }
  return updateData;
}

/* -------------------------------------------- */

/**
 * A general tool to purge flags from all documents in a Compendium pack.
 * @param {CompendiumCollection} pack   The compendium pack to clean.
 * @private
 */
async function purgeFlags(pack) {
  const cleanFlags = (flags) => {
    const flags5e = flags.sds || null;
    return flags5e ? { sds: flags5e } : {};
  };
  await pack.configure({ locked: false });
  const content = await pack.getDocuments();
  for (let doc of content) {
    const update = { flags: cleanFlags(doc.flags) };
    if (pack.documentName === "Actor") {
      update.items = doc.items.map((i) => {
        i.flags = cleanFlags(i.flags);
        return i;
      });
    }
    await doc.update(update, { recursive: false });
    console.log(`Purged flags from ${doc.name}`);
  }
  await pack.configure({ locked: true });
}

var migrations = /*#__PURE__*/ Object.freeze({
  __proto__: null,
  getMigrationData: getMigrationData,
  migrateActorData: migrateActorData,
  migrateArmorClass: migrateArmorClass,
  migrateCompendium: migrateCompendium,
  migrateEffectData: migrateEffectData,
  migrateEffects: migrateEffects,
  migrateItemData: migrateItemData,
  migrateMacroData: migrateMacroData,
  migrateSceneData: migrateSceneData,
  migrateWorld: migrateWorld,
  purgeFlags: purgeFlags,
  refreshAllCompendiums: refreshAllCompendiums,
  refreshCompendium: refreshCompendium,
});

/**
 * The SdS game system for Foundry Virtual Tabletop
 * A system for playing the fifth edition of the world's most popular role-playing game.
 * Author: Atropos
 * Software License: MIT
 * Content License: https://media.wizards.com/2016/downloads/DND/SRD-OGL_V5.1.pdf
 * Repository: https://github.com/foundryvtt/sds
 * Issue Tracker: https://github.com/foundryvtt/sds/issues
 */

/* -------------------------------------------- */
/*  Define Module Structure                     */
/* -------------------------------------------- */

globalThis.sds = {
  applications,
  canvas: canvas$1,
  config: SdS,
  dataModels,
  dice,
  documents,
  migrations,
  utils,
};

/* -------------------------------------------- */
/*  Foundry VTT Initialization                  */
/* -------------------------------------------- */

Hooks.once("init", function () {
  globalThis.sds = game.sds = Object.assign(game.system, globalThis.sds);
  console.log(
    `SdS | Initializing the SdS Game System - Version ${sds.version}\n${SdS.ASCII}`
  );

  /** @deprecated */
  Object.defineProperty(sds, "entities", {
    get() {
      foundry.utils.logCompatibilityWarning(
        "You are referencing the 'sds.entities' property which has been deprecated and renamed to " +
          "'sds.documents'. Support for this old path will be removed in a future version.",
        { since: "SdS 2.0", until: "SdS 2.2" }
      );
      return sds.documents;
    },
  });

  /** @deprecated */
  Object.defineProperty(sds, "rollItemMacro", {
    get() {
      foundry.utils.logCompatibilityWarning(
        "You are referencing the 'sds.rollItemMacro' method which has been deprecated and renamed to " +
          "'sds.documents.macro.rollItem'. Support for this old path will be removed in a future version.",
        { since: "SdS 2.0", until: "SdS 2.2" }
      );
      return sds.documents.macro.rollItem;
    },
  });

  /** @deprecated */
  Object.defineProperty(sds, "macros", {
    get() {
      foundry.utils.logCompatibilityWarning(
        "You are referencing the 'sds.macros' property which has been deprecated and renamed to " +
          "'sds.documents.macro'. Support for this old path will be removed in a future version.",
        { since: "SdS 2.0", until: "SdS 2.2" }
      );
      return sds.documents.macro;
    },
  });

  // Record Configuration Values
  CONFIG.SdS = SdS;
  CONFIG.ActiveEffect.documentClass = ActiveEffect5e;
  CONFIG.Actor.documentClass = Actor5e;
  CONFIG.Item.documentClass = Item5e;
  CONFIG.Token.documentClass = TokenDocument5e;
  CONFIG.Token.objectClass = Token5e;
  CONFIG.time.roundTime = 6;
  CONFIG.Dice.DamageRoll = DamageRoll;
  CONFIG.Dice.D20Roll = D20Roll;
  CONFIG.MeasuredTemplate.defaults.angle = 53.13; // 5e cone RAW should be 53.13 degrees
  CONFIG.ui.combat = CombatTracker5e;

  // Register System Settings
  registerSystemSettings();

  // Validation strictness.
  _determineValidationStrictness();

  // Configure module art.
  game.sds.moduleArt = new ModuleArt();

  // Remove honor & sanity from configuration if they aren't enabled
  if (!game.settings.get("sds", "honorScore")) {
    delete SdS.abilities.hon;
    delete SdS.abilityAbbreviations.hon;
  }
  if (!game.settings.get("sds", "sanityScore")) {
    delete SdS.abilities.san;
    delete SdS.abilityAbbreviations.san;
  }

  // Patch Core Functions
  Combatant.prototype.getInitiativeRoll = getInitiativeRoll;

  // Register Roll Extensions
  CONFIG.Dice.rolls.push(D20Roll);
  CONFIG.Dice.rolls.push(DamageRoll);

  // Hook up system data types
  CONFIG.Actor.systemDataModels = config$2;
  CONFIG.Item.systemDataModels = config$1;
  CONFIG.JournalEntryPage.systemDataModels = config;

  // Register sheet application classes
  Actors.unregisterSheet("core", ActorSheet);
  Actors.registerSheet("sds", ActorSheet5eCharacter, {
    types: ["character"],
    makeDefault: true,
    label: "SdS.SheetClassCharacter",
  });
  Actors.registerSheet("sds", ActorSheet5eNPC, {
    types: ["npc"],
    makeDefault: true,
    label: "SdS.SheetClassNPC",
  });
  Actors.registerSheet("sds", ActorSheet5eVehicle, {
    types: ["vehicle"],
    makeDefault: true,
    label: "SdS.SheetClassVehicle",
  });
  Actors.registerSheet("sds", GroupActorSheet, {
    types: ["group"],
    makeDefault: true,
    label: "SdS.SheetClassGroup",
  });

  Items.unregisterSheet("core", ItemSheet);
  Items.registerSheet("sds", ItemSheet5e, {
    makeDefault: true,
    label: "SdS.SheetClassItem",
  });
  DocumentSheetConfig.registerSheet(
    JournalEntryPage,
    "sds",
    JournalClassPageSheet,
    {
      label: "SdS.SheetClassClassSummary",
      types: ["class"],
    }
  );

  // Preload Handlebars helpers & partials
  registerHandlebarsHelpers();
  preloadHandlebarsTemplates();
});

/**
 * Determine if this is a 'legacy' world with permissive validation, or one where strict validation is enabled.
 * @internal
 */
function _determineValidationStrictness() {
  SystemDataModel._enableV10Validation = game.settings.get(
    "sds",
    "strictValidation"
  );
}

/**
 * Update the world's validation strictness setting based on whether validation errors were encountered.
 * @internal
 */
async function _configureValidationStrictness() {
  if (!game.user.isGM) return;
  const invalidDocuments =
    game.actors.invalidDocumentIds.size + game.items.invalidDocumentIds.size;
  const strictValidation = game.settings.get("sds", "strictValidation");
  if (invalidDocuments && strictValidation) {
    await game.settings.set("sds", "strictValidation", false);
    game.socket.emit("reload");
    foundry.utils.debouncedReload();
  }
}

/* -------------------------------------------- */
/*  Foundry VTT Setup                           */
/* -------------------------------------------- */

/**
 * Prepare attribute lists.
 */
Hooks.once("setup", function () {
  CONFIG.SdS.trackableAttributes = expandAttributeList(
    CONFIG.SdS.trackableAttributes
  );
  CONFIG.SdS.consumableResources = expandAttributeList(
    CONFIG.SdS.consumableResources
  );
  game.sds.moduleArt.registerModuleArt();
});

/* --------------------------------------------- */

/**
 * Expand a list of attribute paths into an object that can be traversed.
 * @param {string[]} attributes  The initial attributes configuration.
 * @returns {object}  The expanded object structure.
 */
function expandAttributeList(attributes) {
  return attributes.reduce((obj, attr) => {
    foundry.utils.setProperty(obj, attr, true);
    return obj;
  }, {});
}

/* --------------------------------------------- */

/**
 * Perform one-time pre-localization and sorting of some configuration objects
 */
Hooks.once("i18nInit", () => performPreLocalization(CONFIG.SdS));

/* -------------------------------------------- */
/*  Foundry VTT Ready                           */
/* -------------------------------------------- */

/**
 * Once the entire VTT framework is initialized, check to see if we should perform a data migration
 */
Hooks.once("ready", function () {
  // Configure validation strictness.
  _configureValidationStrictness();

  // Apply custom compendium styles to the SRD rules compendium.
  const rules = game.packs.get("sds.rules");
  rules.apps = [new SRDCompendium(rules)];

  // Wait to register hotbar drop hook on ready so that modules could register earlier if they want to
  Hooks.on("hotbarDrop", (bar, data, slot) => {
    if (["Item", "ActiveEffect"].includes(data.type)) {
      create5eMacro(data, slot);
      return false;
    }
  });

  // Determine whether a system migration is required and feasible
  if (!game.user.isGM) return;
  const cv =
    game.settings.get("sds", "systemMigrationVersion") ||
    game.world.flags.sds?.version;
  const totalDocuments = game.actors.size + game.scenes.size + game.items.size;
  if (!cv && totalDocuments === 0)
    return game.settings.set(
      "sds",
      "systemMigrationVersion",
      game.system.version
    );
  if (cv && !isNewerVersion(game.system.flags.needsMigrationVersion, cv))
    return;

  // Perform the migration
  if (cv && isNewerVersion(game.system.flags.compatibleMigrationVersion, cv)) {
    ui.notifications.error(
      game.i18n.localize("MIGRATION.5eVersionTooOldWarning"),
      { permanent: true }
    );
  }
  migrateWorld();
});

/* -------------------------------------------- */
/*  Canvas Initialization                       */
/* -------------------------------------------- */

Hooks.on("canvasInit", (gameCanvas) => {
  gameCanvas.grid.diagonalRule = game.settings.get("sds", "diagonalMovement");
  SquareGrid.prototype.measureDistances = measureDistances;
});

/* -------------------------------------------- */
/*  Other Hooks                                 */
/* -------------------------------------------- */

Hooks.on("renderChatMessage", onRenderChatMessage);
Hooks.on("getChatLogEntryContext", addChatMessageContextOptions);

Hooks.on("renderChatLog", (app, html, data) => Item5e.chatListeners(html));
Hooks.on("renderChatPopout", (app, html, data) => Item5e.chatListeners(html));
Hooks.on("getActorDirectoryEntryContext", Actor5e.addDirectoryContextOptions);

export {
  SdS,
  applications,
  canvas$1 as canvas,
  dataModels,
  dice,
  documents,
  migrations,
  utils,
};
//# sourceMappingURL=sds-compiled.mjs.map
