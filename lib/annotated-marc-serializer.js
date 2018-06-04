/**
 * @typedef {object} AnnotatedMarcRuleSubfieldSpec
 * @property {array<string>} subfields - Array of subfields to match
 * @property {string} directive - Indicates whether the matching subfields
 *                                should be "include"d or "exclude"d
 */

/**
 *
 * @typedef {object} AnnotatedMarcRule
 * @property {string} fieldTag - Single character tag broadly classifying tag (e.g. 'y')
 * @property {string} marcIndicatorRegExp - Stringified regex for matching a
 *                    VarField tag joined to 1st and 2nd indicators
 * @property {AnnotatedMarcRuleSubfieldSpec} subfieldSpec - How to match subfields
 * @property {string} label - What label to use in mapping
 * @property {string} directive - Whether to include/exclude if matched.
 */

/**
 * @typedef {object} SubField
 * @property {string} tag - Identifying tag (e.g. '6', 'a')
 * @property {string} content - Value of subfield
 */

/**
 * @typedef {object} VarField
 * @property {string} marcTag - Three digit number classifying field (e.g. '100')
 * @property {string} fieldTag - Single character tag broadly classifying tag (e.g. 'y')
 * @property {string} content - Root level content (usually null/ignored)
 * @property {array<SubField>} subfields
 */

/**
 * @typedef {object} Bib
 * @property {array<VarField>} varFields - Array of varfields
 */

const arrayUnique = require('./util').arrayUnique

class AnnotatedMarcSerializer {
}

// Load rules form disc serialization:
AnnotatedMarcSerializer.mappingRules = require('../data/annotated-marc-rules.json')
  .map((rule) => {
    return Object.assign({}, rule, {
      marcIndicatorRegExp: new RegExp(rule.marcIndicatorRegExp)
    })
  })

AnnotatedMarcSerializer.orderedFieldTags = arrayUnique(AnnotatedMarcSerializer.mappingRules.map((rule) => rule.fieldTag))

/**
 * Given the raw source of a webpub.def file, returns an array of usable
 * rules that relate field labels to marc queries.
 */
AnnotatedMarcSerializer.parseWebpubToAnnotatedMarcRules = function (webpubContent) {
  const mappingRules = webpubContent.split(/\n/)
    .map((line) => line.trim())
    // Make sure line has content (after removing # comments)
    .filter((line) => line && line.replace(/\s*#.*/, ''))
    // Convert to columns:
    .map((line) => line.split('|'))
    // Convert to named columns:
    .map((line) => {
      return {
        type: line[0],
        fieldTag: line[1],
        marcIndicatorPattern: line[2],
        subfields: line[3],
        label: line[4]
      }
    })
    // Make sure we're handling a 'bib' line
    .filter((line) => line.type === 'b')
    .map((line) => {
      // Raw examples:
      // b|s|8..|-6|Series||b|
      // b|r|310|-6|Current Frequency||b|
      // b|y|8[^5].|u|||b|

      let subfields = Array.from(line.subfields)
      let subfieldSpec = { subfields, directive: 'include' }
      if (subfields[0] === '-') subfieldSpec = { subfields: subfields.slice(1), directive: 'exclude' }

      return {
        fieldTag: line.fieldTag,
        marcIndicatorRegExp: new RegExp('^' + line.marcIndicatorPattern),
        subfieldSpec,
        label: line.label,
        directive: line.label ? 'include' : 'exclude'
      }
    })

  return mappingRules
}

/**
 * Given raw webpub.def content, builds an array of {AnnotatedMarcRule}s
 */
AnnotatedMarcSerializer.buildAnnotatedMarcRules = function (webpubContent) {
  return AnnotatedMarcSerializer.parseWebpubToAnnotatedMarcRules(webpubContent)
}

/**
 * Given a sierra marc document, returns an array of varField bocks matching
 * the given rule
 */
AnnotatedMarcSerializer.matchingMarcFields = function (bib, rule) {
  return bib.varFields
    .filter((field) => {
      const fieldMarcIndicator = `${field.marcTag}${field.ind1 || ' '}${field.ind2 || ' '}`
      return rule.marcIndicatorRegExp.test(fieldMarcIndicator) &&
        rule.fieldTag === field.fieldTag
    })
}

/**
 * Given a {VarField} and a {AnnotatedMarcRule}, returns true if matched.
 *
 * @return {boolean}
 */
AnnotatedMarcSerializer.varFieldMatches = function (field, rule) {
  const fieldMarcIndicator = `${field.marcTag}${field.ind1 || ' '}${field.ind2 || ' '}`
  return rule.marcIndicatorRegExp.test(fieldMarcIndicator) &&
    rule.fieldTag === field.fieldTag
}

/**
 *  Given a varField, returns a copy with any hidden subfield content replaced
 *  with "[redacted]" based on given rule
 */
AnnotatedMarcSerializer.buildSourceWithMasking = function (field, rule) {
  return Object.assign({}, field, {
    subfields: (field.subfields || [])
      .map((subfield) => {
        let subfieldContent = subfield.content
        // If directive is 'include' and subfield not included
        // .. or directive is 'exclude', but subfield included,
        // [redact] it:
        if ((rule.subfieldSpec.directive === 'include' && rule.subfieldSpec.subfields.indexOf(subfield.tag) < 0) ||
          (rule.subfieldSpec.directive === 'exclude' && rule.subfieldSpec.subfields.indexOf(subfield.tag) >= 0)) {
          subfieldContent = '[redacted]'
        }
        return Object.assign({}, subfield, { content: subfieldContent })
      })
  })
}

/**
 *  Given an array of varfield blocks and a annotated-marc rule
 *  returns an array of objects with `content` and `source` properties
 */

 /**
 *  Given an varfield block (presumably matching the given rule), returns
 *  an object representing the match.
 */
AnnotatedMarcSerializer.formatVarFieldMatch = function (matchingVarField, rule) {
  const matchedSubfields = (matchingVarField.subfields || []).filter((subfield) => {
    // If rule includes a subfields directive
    if (rule.subfieldSpec) {
      // Is subfields directive exclusionary? Remove matching:
      if (rule.subfieldSpec.directive === 'exclude') return rule.subfieldSpec.subfields.indexOf(subfield.tag) < 0
      // ..Otherwise keep matching:
      else return rule.subfieldSpec.subfields.indexOf(subfield.tag) >= 0
    }
  })
  const content = matchingVarField.content || matchedSubfields.map((f) => f.content).join(' ')

  // Collect other field values apart from primary value:
  const additionalFields = {}

  // For Url mapped blocks, extract label:
  if (rule.label === 'Url') {
    const labelSubfields = ['z']
    additionalFields.label = (matchingVarField.subfields || [])
      .filter((s) => labelSubfields.indexOf(s.tag) >= 0)
      .map((s) => s.content)
      .join(' ')
    // If no label found, use URL
    if (!additionalFields.label) additionalFields.label = content
  }

  // Include source field with masked subfields:
  const source = AnnotatedMarcSerializer.buildSourceWithMasking(matchingVarField, rule)

  return Object.assign(additionalFields, { content, source })
}

AnnotatedMarcSerializer.formatVarFieldMatches = function (matchingVarFields, rule) {
  return matchingVarFields.map((field) => AnnotatedMarcSerializer.formatVarFieldMatch(field, rule))
}

/**
 *  Given a document, a label, and an array of values, adds values to doc
 *
 *  @param {object} doc - The plainobject to update and return
 *  @param {string} label - The label to use
 *  @param {array<string>} values - Array of values to add
 *
 *  @returns {object} The updated document
 */
AnnotatedMarcSerializer.addStatementsToDoc = function (doc, rule, values) {
  const label = rule.label
  const fieldTag = rule.fieldTag
  const fields = doc[fieldTag]
  let last = fields[fields.length - 1]
  if (last && last.label === label) {
    last.values = last.values.concat(values)
  } else {
    fields.push({ label, values })
  }
  return doc
}

/**
 *  Given a doc and a matching rule, writes statement to doc for given varField
 *
 *  @param {object} doc - The plainobject doc to write to
 *  @param {Bib} bib - Bib document (for use in looking up parallel fields)
 *  @param {VarField} varField - VarField from which to extract content.
 *  @param {AnnotatedMarcRule} rule - Rule to apply when extracting content
 *                                    (and looking up parallel fields)
 *
 */
AnnotatedMarcSerializer.addStatementsForVarFieldForRule = function (doc, bib, varField, rule) {
  const content = AnnotatedMarcSerializer.formatVarFieldMatch(varField, rule)
  //
  doc = AnnotatedMarcSerializer.addStatementsToDoc(doc, rule, [content])

  const parallelNumbers = (varField.subfields || [])
    .filter((s) => s.tag === '6')
    .map((s) => s.content.replace(/^880-/, ''))

  if (parallelNumbers.length > 0) {
    // Get parallel varfields:
    const matchingParallels = AnnotatedMarcSerializer.matchingMarcFields(bib, Object.assign({}, rule, { fieldTag: 'y', marcIndicatorRegExp: /^880/ }))
      .map((varField) => {
        return {
          field: varField,
          linkingValue: (varField.subfields.filter((s) => s.tag === '6') || [])
            .map((linkingSubfield) => linkingSubfield.content)
            .pop()
        }
      })
      .filter((parallel) => parallelNumbers.some((parallelNumber) => parallel.linkingValue.indexOf(parallelNumber) === 4))
      .map((parallel) => parallel.field)

    if (matchingParallels.length > 0) {
      const parallelLabel = `Alternate Script for ${rule.label}`
      const parallelContent = AnnotatedMarcSerializer.formatVarFieldMatches(matchingParallels, rule)
      const pseudoRule = { label: parallelLabel, fieldTag: varField.fieldTag }
      doc = AnnotatedMarcSerializer.addStatementsToDoc(doc, pseudoRule, parallelContent)
    }
  }

  return doc
}

/**
 *
 * Given a SierraMarc bib document, returns a new document that presents
 * fields queried via data/annotated-marc-rules.json, grouped by label,
 * and including the marc source - with hidden subfield values redacted.
 *
 * Returns an object resembling:
 *
 *  {
 *    bib: {
 *      fields: [
 *        {
 *          label: "Title",
 *          values: [
 *            {
 *              content: "Time is a flat circle",
 *              source: { ... }
 *            }
 *          ]
 *        }
 *      ]
 *    }
 *  }
 */

AnnotatedMarcSerializer.setRules = function (rules) {
  AnnotatedMarcSerializer.mappingRules = rules
}

AnnotatedMarcSerializer.initialStateObjectForSerialization = function () {
  return AnnotatedMarcSerializer.orderedFieldTags.reduce(function (acc, tag) {
    acc[tag] = []
    return acc
  }, {})
}

AnnotatedMarcSerializer.setRules(AnnotatedMarcSerializer.mappingRules)

AnnotatedMarcSerializer.serialize = function (bib) {
  const doc = bib.varFields.reduce((doc, field) => {
    let foundMatch = false

    AnnotatedMarcSerializer.mappingRules.forEach((rule) => {
      if (!foundMatch && AnnotatedMarcSerializer.varFieldMatches(field, rule)) {
        if (rule.directive === 'include') {
          doc = AnnotatedMarcSerializer.addStatementsForVarFieldForRule(doc, bib, field, rule)
        }
        foundMatch = true
      }
    })

    return doc
  }, AnnotatedMarcSerializer.initialStateObjectForSerialization())
  // Format for return to client:
  return {
    bib: {
      id: bib.id,
      nyplSource: bib.nyplSource,
      fields: Object.keys(doc)
        .reduce((acc, fieldTag) => acc.concat(doc[fieldTag]), [])
    }
  }
}

module.exports = AnnotatedMarcSerializer