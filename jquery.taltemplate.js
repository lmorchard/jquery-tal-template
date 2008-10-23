/**
 * Template utility, based on Zope Page Templates
 *
 * l.m.orchard@pobox.com 
 * http://decafbad.com/
 * Share and Enjoy
 *
 * See also: 
 *     http://wiki.zope.org/ZPT/FrontPage
 *     http://wiki.zope.org/ZPT/AttributeLanguage
 *     http://wiki.zope.org/ZPT/TALSpecification14
 *     http://wiki.zope.org/ZPT/TALESSpecification13
 */
if (jQuery) (function($) {

    // Namespace for template attributes
    var TMPL_NS = 'http://decafbad.com/#tal';

    // Support package used by the .template() method.
    var $S = {};

    /**
     * Process an element as a template with the given namespace.
     */
    $.fn.taltemplate = function(ns, options) {
        var that = this;
        this.find('*').add(this).each(function() { 
            $S.scan(this, ns, that, options) 
        });
        return this;
    };
    $.fn.taltemplate.support = $S;

    /**
     * Scan a given element for attributes corresponding to supported commands
     * and execute those commands when found.
     */
    $S.scan = function(ele, ns, tmpl_ele, options) {
        var attrs = ele.attributes,
            that  = $(ele),
            rm    = [];

        // Skip if there are no attributes.
        if (!attrs) return;

        // Extract all the attributes from the element in question.
        var attrs_hash = {};
        $.each(attrs, function() { 
            attrs_hash[this.nodeName] = this.nodeValue 
        });

        // Set up namespace with built-in names.
        var contexts = {
            nothing:  null, 
            options:  options,
            here:     ns,
            root:     ns,
            attrs:    attrs_hash,
            template: tmpl_ele
        };
        ns = $.extend({}, contexts, { CONTEXTS: contexts }, ns);

        // Run through the commands in precedence order
        for (var j=0, command; command = $S.commands_order[j]; j++) {
            
            // HACK: Stop processing this element if any of it or its parents 
            // have been removed by tmpl:condition or otherwise.
            if (that.hasClass('__removed') || 
                that.parents('.__removed').length) return;

            // Scan all attributes for a match with current command
            var attr_name  = command[0],
                attr_value = attrs_hash[command[0]];
            if ( attr_value ) {
                // Execute a matching command for the current attribute.
                command[1](attr_name, attr_value, that, ns, tmpl_ele); 
                // Remove the attribute so that it's not run again.
                that.removeAttr(attr_name);
            }

        }

    };

    /**
     * Split an expression by delimiter, trimming each part.
     * Note that doubled delimiters, except space, are considered escaped.
     */
    $S.splitExpr = function(delim, str) {
        // HACK: Handle doubled non-space delimiters by temporarily replacing
        // them with a random token.
        var tok = (delim == ' ') ? 
                false : ('##'+(Math.random())+'##').replace(delim, '', 'g'),
            munge = (!tok) ?  str : str.replace(delim+delim, tok, 'g');

        var parts = $.trim(munge).split(delim),
            out   = [];
        for (var i=0, part; part=parts[i], i<parts.length; i++) if (part) { 
            var val = $.trim(''+part);
            // HACK: If there's a random token, replace them with doubled
            // delimiters.
            if (tok) val = val.replace(tok, delim+delim, 'g')
            out.push(val);
        }
        return out;
    },

    /**
     * Look or stash up a value for the given namespace with the given path.
     * see also: http://wiki.zope.org/ZPT/TALESSpecification13
     */
    $S.evalPath = function(ns, expr, def, nocall, value) {
        var expr_parts = $S.splitExpr(' | ', expr);

        for (var i=0, expr_part; expr_part=expr_parts[i]; i++) {
            var parts    = $S.splitExpr(':', expr_part),
                prefix   = (parts.length > 1) ? parts.shift() : 'path',
                rest     = parts.join(':'),
                handlers = $S.evalPath_prefixes,
                handler  = ( handlers[prefix] ) ? 
                    handlers[prefix] : handlers['path'];

            var rv = handler(ns, rest, def, nocall, value);
            if (rv !== null) return rv;
        }
        return null;
    }

    /**
     * Prefix dispatch handlers for path evaluation.
     */
    $S.evalPath_prefixes = { 

        // js: code eval handler
        js: function(ns, path, def, nocall, value) {
            // First, pre-process the JS as a string path with
            // variable substitutions.
            var path = 
                $S.evalPath_prefixes.string(ns, path, def, nocall, value);
            try{
                with(ns) { return eval(path); }
            } catch (e) {
                // TODO: Trip an on-error attribute?
                return null;
            }
        },
        
        // string: value handler
        string: function(ns, path, def, nocall, value) {
            return path.replace(
                /\$\{([^\}]+)}/g, 
                function(match, sub_path) {
                    return $S.evalPath(ns, sub_path, value, null, nocall);
                }
            );
        },

        // path: namespace lookup handler
        path: function(ns, path, def, nocall, value) {
            if (path == 'nothing') return null; 
            if (path == 'default') return def;

            var is_write = (typeof value != 'undefined'),
                parts    = path.split('/'),
                last     = (is_write) ? parts.pop() : null,
                part     = '',
                c_ns     = ns;

            // Traverse the parts of the path through the namespace.
            while (part = parts.shift()) {
                
                // Support '?foo' indirect path resolution from original
                // namespace vars.
                if (part.charAt(0) == '?') {
                    part = ns[part.substr(1)]
                }

                if (typeof c_ns[part] == 'undefined') {
                    // Auto-create path part on write.
                    if (is_write) c_ns[part] = {};
                    // Abort on path failure for reads.
                    else return null;
                }
                
                // Traverse to next step in namespace.
                c_ns = c_ns[part];

                // Further traverse functions by calling.
                if (typeof c_ns == 'function' && nocall != true) {
                    c_ns = c_ns();
                }

            }

            return (is_write) ? ( c_ns[last] = value ) : c_ns;
        },

        // exists: existence condition
        exists: function(ns, path, def, nocall, value) {
            return $S.evalPath(ns, path, value) !== null;
        },

        // nocall: path lookup without function traversal
        nocall: function(ns, path, def, nocall, value) {
            return $S.evalPath(ns, path, value, true);
        },

        // not: truth negation handler
        not: function(ns, path, def, nocall, value) {
            return !($S.evalPath(ns, path, value));
        }
        
    };

    /**
     * Define attribute-based template command handlers.
     * see also: http://wiki.zope.org/ZPT/TALSpecification14
     */
    $S.commands = {

        // tmpl:define - define a new namespace element in the template.
        define: function(attr_name, attr_val, ele, ns) {
            var defines = $S.splitExpr(';', attr_val);
            for (var i=0, sub; sub=defines[i]; i++) {
                var parts = $S.splitExpr(' ', sub),
                    name  = parts.shift(),
                    expr  = parts.join(' '),
                    value = $S.evalPath(ns, expr);

                // TODO: Support local / global modifier.  This is voodoo.
                $S.evalPath(ns, name, null, false, value);
                $S.evalPath(ns['here'], name, null, false, value);
            }
        },

        // tmpl:condition - remove the element if condition is false
        condition: function(attr_name, attr_val, ele, ns) {
            var value = $S.evalPath(ns, attr_val);
            if (!value) {
                // HACK: Annotate the element as removed, then remove it from
                // the template.
                ele.addClass('__removed').remove();
            }
        },

        // tmpl:repeat - use the current element itself as a template, 
        // cloned repeatedly for each item of a list.
        repeat: function(attr_name, attr_val, ele, ns) {
            var parts = $S.splitExpr(' ', attr_val),
                sub   = parts.shift(),
                expr  = parts.join(' '),
                list  = $S.evalPath(ns, expr);
            
            if (list) {

                // If the list is an object, iterate over keys.
                // TODO: Create a generic 'makeIterable' util?
                if (Object.prototype.toString.apply(list) == '[object Object]') {
                    var keys = [];
                    for (k in list) if (list.hasOwnProperty(k)) 
                        keys.push(k);
                    list = keys;
                }

                // Extract all the attributes from the repeat element.
                var attrs = ele[0].attributes, attrs_hash = {};
                $.each(attrs, function() { 
                    attrs_hash[this.name] = this.value 
                });

                // Iterate through the list.
                for (var i=0, row; row=list[i]; i++) {

                    // Build up the namespace for this iteration.
                    var sub_ns = $.extend(
                        {}, ns, { 
                            attrs: attrs_hash,
                            repeat: { item: {
                                index  : i,
                                number : i + 1,
                                even   : ( (i % 2) != 0 ),
                                odd    : ( (i % 2) == 0 ),
                                start  : ( i == 0 ),
                                end    : ( i == list.length-1 ),
                                length : list.length
                            } }
                        }
                    );
                    sub_ns[sub] = row;

                    // Clone the element, remove the repeat command, process 
                    // recursively as a template, and insert as a new item.
                    var tmpl = ele.clone().removeAttr(attr_name);
                    tmpl.find('*').add(tmpl).each(function() { 
                        $S.scan(this, sub_ns) 
                    });
                    ele.before(tmpl);
                }

                // Finally, get rid of the original template element entirely.
                ele.addClass('__removed').remove();
            };
        },

        // tmpl:content - change the text content of the element
        content: function(attr_name, attr_val, ele, ns) {
            // TODO: Make this less hackish?
            var is_structure = false;
            if (attr_val.indexOf('structure ') == 0) {
                is_structure = true;
                attr_val = attr_val.replace('structure ', '');
            } else if (attr_val.indexOf('text ') == 0) {
                attr_val = attr_val.replace('text ', '');
            }

            var value = $S.evalPath(ns, attr_val, 
                is_structure ? ele.html() : ele.text() );

            if (value === null || value === false) return;
            
            if (is_structure) {
                ele.html(value);
            } else {
                ele.text(''+value);
            }
        },

        // tmpl:replace - replace the element entirely
        replace: function(attr_name, attr_val, ele, ns) {
            // TODO: Make this less hackish?
            var is_structure = false;
            if (attr_val.indexOf('structure ') == 0) {
                is_structure = true;
                attr_val = attr_val.replace('structure ', '');
            } else if (attr_val.indexOf('text ') == 0) {
                attr_val = attr_val.replace('text ', '');
            }

            var value = $S.evalPath(ns, attr_val, 
                is_structure ? ele.html() : ele.text() );

            if (value === null || value === false) return;

            if (is_structure) {
                ele.replaceWith(value);
            } else {
                // HACK: escape HTML by throwing it through 
                // a temporary element.
                ele.replaceWith( $('<span/>').text(''+value).html() );
            }
        },
       
        // tmpl:attributes - add or replace attributes on the element
        attributes: function(attr_name, attr_val, ele, ns) {
            var attrs = $S.splitExpr(';', attr_val);
            if (attrs) for (var i=0, sub; sub=attrs[i]; i++) {
                var parts = $S.splitExpr(' ', sub);
                    name  = parts.shift(),
                    rest  = parts.join(' '),
                    value = $S.evalPath(ns, rest, ele.attr(name));

                if (value === null) {
                    ele.removeAttr(name)
                } else {
                    ele.attr(name, ''+value);
                }
            }
        },
       
        // tmpl:omit-tag - when present, promote all children of this element
        // and remove the element itself.
        'omit-tag': function(attr_name, attr_val, ele, ns) {
            // The condition to omit can either be a blank string as attribute
            // value or a true result when evaluated as an expression.
            var omit = false;
            if (attr_val === '') {
                omit = true;
            } else {
                var value = $S.evalPath(ns, attr_val);
                if (value) omit = true;
            }
            
            // Yank and promote the children, yank the former parent.
            if (omit)
                ele.children().remove().insertBefore(ele).end().remove();
        }

    };

    // Discover namespace prefix for template attributes.
    $S.prefix = 'tal';
    $.each($('html')[0].attributes, function() {
        if (this.nodeValue == TMPL_NS)
            $S.prefix = this.nodeName.split(':', 2)[1];
    });

    // Set up a list establishing both op precedence and mapping from 
    // namespace prefix to template op.
    $S.commands_order = [];
    $.each( 
        ['define', 'condition', 'repeat', 'content', 'replace', 'attributes', 'omit-tag'],
        function() { 
            $S.commands_order.push([$S.prefix + ':' + this, $S.commands[this]]);
        }
    );

})(jQuery);
